import * as fs from "node:fs";
import * as path from "node:path";

function getLockFile(file: string): string {
  return `${file}.lock`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === "EPERM";
  }
}

interface LockOptions {
  stale?: boolean | 0;
  retries?: number;
  retryInterval?: number;
}

function acquireLock(file: string, options: LockOptions = {}): boolean {
  const lockfilePath = getLockFile(file);
  const pid = process.pid.toString();

  try {
    fs.writeFileSync(lockfilePath, pid, { flag: "wx" });
    return true;
  } catch (err: any) {
    if (err.code !== "EEXIST") {
      throw err;
    }

    if (options.stale === 0) {
      return false;
    }

    let existingPid: number;
    try {
      existingPid = parseInt(fs.readFileSync(lockfilePath, "utf8"), 10);
    } catch (readErr) {
      fs.unlinkSync(lockfilePath);
      return acquireLock(file, { ...options, stale: 0 });
    }

    const isStale = !isProcessAlive(existingPid);

    if (isStale) {
      try {
        fs.unlinkSync(lockfilePath);
        return acquireLock(file, { ...options, stale: 0 });
      } catch (unlinkErr: any) {
        if (unlinkErr.code === "ENOENT") {
          return acquireLock(file, { ...options, stale: 0 });
        }
        throw unlinkErr;
      }
    }

    return false;
  }
}

export async function lock(
  file: string,
  options: LockOptions = {}
): Promise<() => void> {
  const opts: Required<LockOptions> = {
    stale: true,
    retries: 0,
    retryInterval: 100,
    ...options,
  };

  const resolvedFile = path.resolve(file);
  let attempts = 0;

  while (attempts <= opts.retries) {
    if (acquireLock(resolvedFile, opts)) {
      const release = () => unlock(resolvedFile);
      return release;
    }

    if (attempts < opts.retries) {
      // Proper async delay - doesn't block event loop
      await new Promise((resolve) => setTimeout(resolve, opts.retryInterval));
    }

    attempts++;
  }

  const err: any = new Error("Lock file is already being held");
  err.code = "ELOCKED";
  err.file = resolvedFile;
  throw err;
}

export function unlock(file: string): void {
  const resolvedFile = path.resolve(file);
  const lockfilePath = getLockFile(resolvedFile);

  try {
    const existingPid = parseInt(fs.readFileSync(lockfilePath, "utf8"), 10);

    if (existingPid !== process.pid) {
      const err: any = new Error("Lock is not owned by this process");
      err.code = "ENOTACQUIRED";
      throw err;
    }

    fs.unlinkSync(lockfilePath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      const notAcquiredErr: any = new Error("Lock is not acquired");
      notAcquiredErr.code = "ENOTACQUIRED";
      throw notAcquiredErr;
    }
    throw err;
  }
}

export function check(file: string): boolean {
  const resolvedFile = path.resolve(file);
  const lockfilePath = getLockFile(resolvedFile);

  try {
    const pid = parseInt(fs.readFileSync(lockfilePath, "utf8"), 10);
    return isProcessAlive(pid);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

export function getLockInfo(file: string): { locked: boolean; pid?: number } {
  const resolvedFile = path.resolve(file);
  const lockfilePath = getLockFile(resolvedFile);

  try {
    // Check if the lock file exists
    if (!fs.existsSync(lockfilePath)) {
      return { locked: false };
    }

    // Read the PID from the lock file
    const pidStr = fs.readFileSync(lockfilePath, "utf8");
    const pid = parseInt(pidStr, 10);

    // Check if the process is alive (handles stale detection)
    const isAlive = isProcessAlive(pid);

    if (!isAlive) {
      return { locked: false };
    }

    return { locked: true, pid };
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return { locked: false };
    }
    // If we can't read the lock, assume not locked
    return { locked: false };
  }
}
