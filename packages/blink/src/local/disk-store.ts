import * as fs from "node:fs";
import * as path from "node:path";
import filenamify from "filenamify";
import * as lockfile from "./lockfile";

export interface FileStore {
  read(): Promise<string>;
  write(contents: string): Promise<void>;
  dispose(): void;
}

export interface LockedStoreEntry<T> {
  get: () => Promise<T>;
  set: (value: T) => Promise<void>;
  update: (value: Partial<T>) => Promise<void>;
  delete: () => Promise<void>;
  release: () => Promise<void>;
}

export interface StoreEntry {
  key: string;
  locked: boolean;
  pid?: number;
  // Milliseconds since epoch, for sorting
  mtime: number;
}

/**
 * DiskStore is a key-value store that persists to disk.
 * It works with filesystem locks - so multiple processes can
 * read and write to the store concurrently.
 */
export interface Store<T extends object> {
  get: (key: string) => Promise<T | undefined>;
  list: () => Promise<StoreEntry[]>;
  lock: (
    key: string,
    opts?: { force?: boolean }
  ) => Promise<LockedStoreEntry<T>>;
  dispose: () => void;
}

/**
 * Helper functions shared by stores
 */
const ensureDir = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
};

const fdatasyncAndClose = (fd: number) => {
  try {
    fs.fdatasyncSync(fd);
  } catch {}
  try {
    fs.closeSync(fd);
  } catch {}
};

const fsyncPath = (p: string) => {
  try {
    const fd = fs.openSync(p, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
};

const writeAtomicFile = (filePath: string, contents: string) => {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = path.join(
    dir,
    ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2)
  );
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeFileSync(fd, contents, "utf-8");
    fdatasyncAndClose(fd);
    fd = undefined;
    fs.renameSync(tmp, filePath);
    // fsync file and directory to reasonably ensure durability
    fsyncPath(filePath);
    fsyncPath(dir);
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    throw err;
  }
};

/**
 * createFileStore creates a simple file-based store with atomic read/write.
 * All operations are protected by filesystem locks for multi-process safety.
 */
export const createFileStore = (
  filePath: string,
  opts?: {
    stale?: boolean;
    retries?: number;
    retryInterval?: number;
  }
): FileStore => {
  const lockOpts = {
    stale: opts?.stale ?? true,
    retries: opts?.retries ?? 5,
    retryInterval: opts?.retryInterval ?? 100,
  };

  return {
    async read() {
      // Ensure directory exists
      ensureDir(path.dirname(filePath));

      // Create file if it doesn't exist
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "", "utf-8");
      }

      const release = await lockfile.lock(filePath, lockOpts);
      try {
        return fs.readFileSync(filePath, "utf-8");
      } finally {
        release();
      }
    },

    async write(contents: string) {
      ensureDir(path.dirname(filePath));

      // Create file if it doesn't exist
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "", "utf-8");
      }

      const release = await lockfile.lock(filePath, lockOpts);
      try {
        writeAtomicFile(filePath, contents);
      } finally {
        release();
      }
    },

    dispose() {
      // Nothing to clean up
    },
  };
};

/**
 * createDiskStore creates a store that persists to disk.
 */
export const createDiskStore = <T extends object>(
  dataDirectory: string,
  idKey: keyof T
): Store<T> => {
  type IndexFile = {
    current?: string; // most recently written id (optional)
    ids: Record<string, string>; // id -> filename (relative file within dataDirectory)
  };

  const locks = new Map<string, () => Promise<void>>(); // tracks active locks by key
  let indexLockRelease: (() => Promise<void>) | undefined; // lock for index file operations

  const readJSONIfExists = (filePath: string): any | undefined => {
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stat) return undefined;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  };

  const writeAtomicJSON = (filePath: string, data: unknown) => {
    writeAtomicFile(filePath, JSON.stringify(data, null, 2));
  };

  const lockIndex = async (): Promise<() => void> => {
    if (indexLockRelease) {
      throw new Error("Index is already locked");
    }
    const indexPath = path.join(dataDirectory, "index.json");
    ensureDir(dataDirectory);
    // Ensure index file exists
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, JSON.stringify({ ids: {} }), "utf-8");
    }
    const release = await lockfile.lock(indexPath, {
      stale: true,
      retries: 5,
      retryInterval: 100,
    });
    indexLockRelease = () => Promise.resolve(release());
    return () => {
      release();
      indexLockRelease = undefined;
    };
  };

  const readIndex = async (): Promise<IndexFile> => {
    const indexPath = path.join(dataDirectory, "index.json");
    const read: IndexFile = readJSONIfExists(indexPath) ?? { ids: {} };
    // Normalize structure
    if (!read.ids) read.ids = {};
    return read;
  };

  const writeIndex = async (index: IndexFile) => {
    const indexPath = path.join(dataDirectory, "index.json");
    writeAtomicJSON(indexPath, index);
  };

  const getKeyFilePath = async (key: string): Promise<string | undefined> => {
    const idx = await readIndex();
    const rel = idx.ids[key];
    if (!rel) return undefined;
    return path.join(dataDirectory, rel);
  };

  const readValueById = async (id: string): Promise<T | undefined> => {
    const idx = await readIndex();
    const rel = idx.ids[id];
    if (!rel) return undefined;
    const filePath = path.join(dataDirectory, rel);
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stat) return undefined;
    const value = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return value;
  };

  const writeValue = async (value: T) => {
    // Note: This is only called from within a lock handle, so we already hold the lock
    const anyValue: any = value as any;
    const idRaw = anyValue[idKey];
    const idStr = String(idRaw);
    const fileNameBase = filenamify(idStr, { replacement: "_" });
    const fileName = fileNameBase + ".json";

    // Lock index for atomic update
    const releaseIndex = await lockIndex();
    try {
      const idx = await readIndex();
      idx.ids[idStr] = fileName;
      idx.current = idStr;

      // Persist value first, then the index pointer
      const valuePath = path.join(dataDirectory, fileName);
      writeAtomicJSON(valuePath, value);
      await writeIndex(idx);
    } finally {
      await releaseIndex();
    }
  };

  return {
    async get(key: string) {
      return await readValueById(key);
    },
    async list(): Promise<StoreEntry[]> {
      const stat = fs.statSync(dataDirectory, { throwIfNoEntry: false });
      if (!stat) return [];

      const idx = await readIndex();
      const entries: StoreEntry[] = [];

      for (const [key, filename] of Object.entries(idx.ids)) {
        const filePath = path.join(dataDirectory, filename);

        // Get file mtime
        const fileStat = fs.statSync(filePath, { throwIfNoEntry: false });
        if (!fileStat) continue; // Skip if file doesn't exist

        // Check lock status (handles stale detection and gets PID)
        const lockInfo = lockfile.getLockInfo(filePath);

        entries.push({
          key,
          locked: lockInfo.locked,
          pid: lockInfo.pid,
          mtime: fileStat.mtimeMs,
        });
      }

      // Sort by mtime descending (most recent first)
      entries.sort((a, b) => b.mtime - a.mtime);

      return entries;
    },
    async lock(
      key: string,
      lockOpts?: { force?: boolean }
    ): Promise<LockedStoreEntry<T>> {
      if (locks.has(key)) {
        throw new Error(`Key "${key}" is already locked in this process`);
      }

      // Ensure the file exists before locking
      let filePath = await getKeyFilePath(key);
      if (!filePath) {
        // If the key doesn't exist yet, create an empty file to lock
        const fileNameBase = filenamify(key, { replacement: "_" });
        const fileName = fileNameBase + ".json";

        // Lock index for atomic update
        const releaseIndex = await lockIndex();
        try {
          const idx = await readIndex();
          idx.ids[key] = fileName;
          const valuePath = path.join(dataDirectory, fileName);
          ensureDir(dataDirectory);
          // Create an empty placeholder file
          fs.writeFileSync(valuePath, JSON.stringify({}), "utf-8");
          await writeIndex(idx);

          filePath = valuePath;
        } finally {
          await releaseIndex();
        }
      }

      // If force option is set, try to kill the holder
      if (lockOpts?.force) {
        const lockInfo = lockfile.getLockInfo(filePath);
        if (lockInfo.locked && lockInfo.pid && lockInfo.pid !== process.pid) {
          try {
            // Send SIGTERM to the holder
            process.kill(lockInfo.pid, "SIGTERM");
            // Wait a bit for process to exit and release lock
            await new Promise((resolve) => setTimeout(resolve, 100));
          } catch (err: any) {
            // Process might already be dead (ESRCH), that's fine
            if (err.code !== "ESRCH") {
              console.warn(
                `Failed to kill process ${lockInfo.pid}:`,
                err.message
              );
            }
          }
        }
      }

      // Acquire the lock using lockfile
      const releaseLockfile = await lockfile.lock(filePath, {
        stale: true,
        retries: lockOpts?.force ? 10 : 5,
        retryInterval: lockOpts?.force ? 100 : 100,
      });

      // Store the release function
      locks.set(key, () => Promise.resolve(releaseLockfile()));

      // Return locked store handle
      return {
        async get() {
          const value = await readValueById(key);
          if (!value) {
            throw new Error(`Key ${key} not found`);
          }
          return value;
        },
        async set(value: T) {
          await writeValue(value);
        },
        async update(value: Partial<T>) {
          // Read the current value for update
          const current = await readValueById(key);
          if (!current || !(idKey in current)) {
            throw new Error(`Key ${key} not found`);
          }
          await writeValue({
            ...current,
            ...value,
          });
        },
        async delete() {
          // First update index to remove the entry
          // This will trigger watchers to emit deletion events
          const releaseIndex = await lockIndex();
          try {
            const idx = await readIndex();
            const rel = idx.ids[key];
            if (rel) {
              // Remove from index FIRST so watchers see the deletion
              delete idx.ids[key];
              if (idx.current === key) {
                idx.current = undefined;
              }
              await writeIndex(idx);

              // THEN delete the data file (but NOT the lock file - release() will handle it)
              const deletePath = path.join(dataDirectory, rel);

              try {
                fs.rmSync(deletePath, { force: true });
                // fsync directory to persist deletion of entry
                fsyncPath(dataDirectory);
              } catch {}
            }
          } finally {
            await releaseIndex();
          }
        },
        async release() {
          releaseLockfile();
          locks.delete(key);
        },
      };
    },
    dispose() {
      // Release all locks
      locks.clear();
    },
  };
};

export interface DiskStoreWatcher<T = any> {
  onChange: (
    callback: (event: {
      key: string;
      value: T | undefined;
      locked: boolean;
      pid?: number;
    }) => void
  ) => () => void;
  dispose: () => void;
}

/**
 * createDiskStoreWatcher creates a watcher for the disk store.
 * It watches the disk store for changes and emits events when the
 * store changes.
 *
 * It also polls the store for changes in case the watcher misses
 * any changes.
 *
 * It also debounces the changes to prevent too many events from
 * being emitted.
 */
export const createDiskStoreWatcher = <T extends object = any>(
  dataDirectory: string,
  opts?: {
    pollInterval?: number; // Poll interval in ms (default 1000)
    debounce?: number; // Debounce time in ms (default 50)
  }
): DiskStoreWatcher<T> => {
  const pollInterval = opts?.pollInterval ?? 200; // Faster polling for better multi-process sync
  const debounceTime = opts?.debounce ?? 50;

  const changeCallbacks = new Set<
    (event: {
      key: string;
      value: T | undefined;
      locked: boolean;
      pid?: number;
    }) => void
  >();
  let watcher: fs.FSWatcher | undefined;
  let pollTimer: NodeJS.Timeout | undefined;
  const debounceTimers = new Map<string, NodeJS.Timeout>();

  // Track file mtimes, lock states, and cached values to detect changes
  const fileStates = new Map<
    string,
    {
      mtime: number;
      key: string;
      locked: boolean;
      pid?: number;
      cachedValue?: T;
    }
  >();

  const indexPath = path.join(dataDirectory, "index.json");

  const readIndexFile = (): { ids: Record<string, string> } => {
    try {
      const stat = fs.statSync(indexPath, { throwIfNoEntry: false });
      if (!stat) return { ids: {} };
      const content = fs.readFileSync(indexPath, "utf-8");
      const parsed = JSON.parse(content);
      return { ids: parsed.ids ?? {} };
    } catch {
      return { ids: {} };
    }
  };

  const emitChange = (
    key: string,
    value: T | undefined,
    locked: boolean,
    pid?: number
  ) => {
    for (const callback of changeCallbacks) {
      try {
        callback({ key, value, locked, pid });
      } catch (err) {
        console.error("Error in onChange callback:", err);
      }
    }
  };

  const checkFile = (
    key: string,
    filename: string,
    checkLock: boolean = false
  ) => {
    const filePath = path.join(dataDirectory, filename);

    try {
      const stat = fs.statSync(filePath, { throwIfNoEntry: false });
      const existing = fileStates.get(filename);

      if (!stat) {
        // File deleted - always emit if we had it before
        if (existing) {
          fileStates.delete(filename);
          emitChange(key, undefined, false);
        }
        return;
      }

      const mtime = stat.mtimeMs;

      // Only check lock status if requested or if this is a new file
      // This significantly reduces I/O operations
      let lockInfo: { locked: boolean; pid?: number } = existing
        ? { locked: existing.locked, pid: existing.pid }
        : { locked: false, pid: undefined };

      if (checkLock || !existing) {
        lockInfo = lockfile.getLockInfo(filePath);
      }

      // Emit change if mtime changed OR lock status changed OR new file
      if (
        !existing ||
        existing.mtime !== mtime ||
        existing.locked !== lockInfo.locked ||
        existing.pid !== lockInfo.pid
      ) {
        // Only read and parse file if mtime actually changed (not just lock status)
        let value: T | undefined;
        if (!existing || existing.mtime !== mtime) {
          value = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } else {
          // Mtime hasn't changed, just lock status changed
          // Re-use the cached value to avoid expensive file read + JSON parse
          value = existing.cachedValue;
        }

        // Update state with new cached value
        fileStates.set(filename, {
          mtime,
          key,
          locked: lockInfo.locked,
          pid: lockInfo.pid,
          cachedValue: value,
        });

        emitChange(key, value, lockInfo.locked, lockInfo.pid);
      }
    } catch (err) {
      // Ignore read errors
    }
  };

  const poll = () => {
    try {
      const idx = readIndexFile();
      const currentKeys = new Set(Object.keys(idx.ids));

      // Check all current files including lock status
      // This serves as a backup in case fs.watch misses lock file changes
      for (const [key, filename] of Object.entries(idx.ids)) {
        checkFile(key, filename, true);
      }

      // Check for deleted files
      for (const [filename, state] of fileStates.entries()) {
        if (!currentKeys.has(state.key)) {
          fileStates.delete(filename);
          emitChange(state.key, undefined, false);
        }
      }
    } catch (err) {
      // Ignore polling errors
    }
  };

  const scheduleDebounce = (
    key: string,
    filename: string,
    checkLock: boolean = false
  ) => {
    const existing = debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    debounceTimers.set(
      key,
      setTimeout(() => {
        debounceTimers.delete(key);
        checkFile(key, filename, checkLock);
      }, debounceTime)
    );
  };

  const initWatcher = () => {
    if (watcher) return;

    // Ensure directory exists
    try {
      fs.mkdirSync(dataDirectory, { recursive: true });
    } catch {}

    // Start file system watcher for fast updates
    watcher = fs.watch(dataDirectory, (eventType, filename) => {
      if (!filename || filename.startsWith(".tmp-")) {
        return;
      }

      // On index changes, immediately poll to catch deletions/additions
      if (filename === "index.json") {
        poll();
        return;
      }

      // Watch for lock file changes (file.json.lock)
      if (filename.endsWith(".lock")) {
        const dataFilename = filename.replace(".lock", "");
        const idx = readIndexFile();
        const key = Object.keys(idx.ids).find(
          (k) => idx.ids[k] === dataFilename
        );
        if (key) {
          // Immediately check lock status when lock file changes
          checkFile(key, dataFilename, true);
        }
        return;
      }

      // Map filename to key
      const idx = readIndexFile();
      const key = Object.keys(idx.ids).find((k) => idx.ids[k] === filename);

      if (key) {
        // Data file changed - check without forcing lock check (optimization)
        scheduleDebounce(key, filename, false);
      }
    });

    // Start polling as backup
    const doPoll = () => {
      poll();
      pollTimer = setTimeout(doPoll, pollInterval);
    };

    // Initial poll
    poll();
    pollTimer = setTimeout(doPoll, pollInterval);
  };

  return {
    onChange(callback) {
      // Initialize watcher on first subscription
      if (changeCallbacks.size === 0) {
        initWatcher();
      }

      changeCallbacks.add(callback);

      // Return unsubscribe function
      return () => {
        changeCallbacks.delete(callback);

        // Clean up watcher if no more subscribers
        if (changeCallbacks.size === 0) {
          if (watcher) {
            watcher.close();
            watcher = undefined;
          }

          if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
          }

          // Clear any pending debounce timers
          for (const timer of debounceTimers.values()) {
            clearTimeout(timer);
          }
          debounceTimers.clear();

          // Clear state
          fileStates.clear();
        }
      };
    },
    dispose() {
      // Close watcher
      if (watcher) {
        watcher.close();
        watcher = undefined;
      }

      // Clear poll timer
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }

      // Clear debounce timers
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();

      // Clear callbacks and state
      changeCallbacks.clear();
      fileStates.clear();
    },
  };
};
