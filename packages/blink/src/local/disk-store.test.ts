import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDiskStore,
  createDiskStoreWatcher,
  createFileStore,
} from "./disk-store";

interface ChatLike {
  id: string;
  created_at: string;
  updated_at: string;
  messages: any[];
}

const makeChat = (id: string): ChatLike => ({
  id,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  messages: [],
});

test("DiskStore: set/get persists across instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store1 = createDiskStore<ChatLike>(dir, "id");
    const key = "1";
    const value = makeChat("1");

    const locked = await store1.lock(key);
    await locked.set(value);
    await locked.release();

    const read1 = await store1.get(key);
    expect(read1).toBeDefined();
    expect(read1!.id).toBe("1");

    const store2 = createDiskStore<ChatLike>(dir, "id");
    const read2 = await store2.get(key);
    expect(read2).toBeDefined();
    expect(read2!.id).toBe("1");

    // index.json exists at the top-level
    const indexPath = join(dir, "index.json");
    expect(existsSync(indexPath)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: list and delete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    const locked1 = await store.lock("1");
    await locked1.set(makeChat("1"));
    await locked1.release();

    const locked2 = await store.lock("2");
    await locked2.set(makeChat("2"));
    await locked2.release();

    const entries = await store.list();
    const keys = entries.map((e) => e.key);
    expect(keys.sort()).toEqual(["1", "2"]);

    const lockedDel = await store.lock("1");
    await lockedDel.delete();
    await lockedDel.release();

    const entriesAfter = await store.list();
    expect(entriesAfter.map((e) => e.key)).toEqual(["2"]);
    const file1 = join(dir, "1.json");
    expect(statSync(file1, { throwIfNoEntry: false })).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: multiple writes create separate files and advance global index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    const locked1 = await store.lock("1");
    await locked1.set(makeChat("1"));
    await locked1.release();

    const locked2 = await store.lock("2");
    await locked2.set(makeChat("2"));
    await locked2.release();

    // index.json should point to current = "2"
    const indexPath = join(dir, "index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    expect(index.current).toBe("2");

    // both files exist
    const v1 = join(dir, "1.json");
    const v2 = join(dir, "2.json");
    expect(existsSync(v1)).toBe(true);
    expect(existsSync(v2)).toBe(true);

    const latest = await store.get("2");
    expect(latest).toBeDefined();
    expect(latest!.id).toBe("2");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: update modifies existing entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    const locked = await store.lock("1");
    await locked.set(makeChat("1"));
    const original = await store.get("1");
    expect(original).toBeDefined();
    expect(original!.messages).toEqual([]);

    await locked.update({ messages: [{ text: "hello" }] });
    const updated = await store.get("1");
    expect(updated).toBeDefined();
    expect(updated!.messages).toEqual([{ text: "hello" }]);
    expect(updated!.id).toBe("1");
    await locked.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: update throws on non-existent key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    // Lock creates a placeholder, but update should still throw if no real data
    const locked = await store.lock("nonexistent");

    // The placeholder is just {}, so get() returns it but it's not a valid ChatLike
    // Update will fail because there's no data
    await expect(locked.update({ messages: [] })).rejects.toThrow(
      "Key nonexistent not found"
    );
    await locked.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: lock prevents other instances from locking", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store1 = createDiskStore<ChatLike>(dir, "id");
    const store2 = createDiskStore<ChatLike>(dir, "id");

    const locked1 = await store1.lock("1");
    await locked1.set(makeChat("1"));

    // Try to lock from another instance
    await expect(store2.lock("1")).rejects.toThrow();

    await locked1.release();

    // After releasing, store2 should be able to lock
    const locked2 = await store2.lock("1");
    await locked2.set(makeChat("1"));
    await locked2.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: can lock and modify same key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    const locked = await store.lock("1");
    await locked.set(makeChat("1"));

    // Can modify while we hold the lock
    await locked.update({ messages: [{ text: "test" }] });

    const value = await store.get("1");
    expect(value!.messages).toEqual([{ text: "test" }]);

    await locked.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: can lock non-existent key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    // Lock a key that doesn't exist yet - should create placeholder
    const locked = await store.lock("newkey");

    // Verify the key file was created
    const entries = await store.list();
    expect(entries.map((e) => e.key)).toContain("newkey");

    // Can set it while we hold the lock
    await locked.set(makeChat("newkey"));
    await locked.release();

    const value = await store.get("newkey");
    expect(value).toBeDefined();
    expect(value!.id).toBe("newkey");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: double lock in same process throws", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    const locked1 = await store.lock("1");
    await locked1.set(makeChat("1"));

    await expect(store.lock("1")).rejects.toThrow(
      'Key "1" is already locked in this process'
    );

    await locked1.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: reading without lock is allowed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    const locked = await store.lock("1");
    await locked.set(makeChat("1"));
    await locked.release();

    // Can read without holding a lock
    const value = await store.get("1");
    expect(value).toBeDefined();
    expect(value!.id).toBe("1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: lock prevents access from another store instance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store1 = createDiskStore<ChatLike>(dir, "id");
    const store2 = createDiskStore<ChatLike>(dir, "id");

    const locked1 = await store1.lock("1");
    await locked1.set(makeChat("1"));

    // store2 should not be able to lock while store1 holds it
    await expect(store2.lock("1")).rejects.toThrow();

    await locked1.release();

    // After releasing, store2 should be able to lock
    const locked2 = await store2.lock("1");
    await locked2.set(makeChat("1"));
    await locked2.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: reading from unlocked store is allowed while locked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store1 = createDiskStore<ChatLike>(dir, "id");
    const store2 = createDiskStore<ChatLike>(dir, "id");

    const locked = await store1.lock("1");
    await locked.set(makeChat("1"));

    // store2 can read while store1 holds the lock
    const value = await store2.get("1");
    expect(value).toBeDefined();
    expect(value!.id).toBe("1");

    // List should also work
    const entries = await store2.list();
    expect(entries.map((e) => e.key)).toContain("1");

    await locked.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: concurrent lock operations serialize correctly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    // Perform sequential writes (each acquires lock)
    const locked1 = await store.lock("1");
    await locked1.set(makeChat("1"));
    await locked1.release();

    const locked2 = await store.lock("2");
    await locked2.set(makeChat("2"));
    await locked2.release();

    const locked3 = await store.lock("3");
    await locked3.set(makeChat("3"));
    await locked3.release();

    const entries = await store.list();
    const keys = entries.map((e) => e.key);
    expect(keys.sort()).toEqual(["1", "2", "3"]);

    // All values should be readable
    const val1 = await store.get("1");
    const val2 = await store.get("2");
    const val3 = await store.get("3");
    expect(val1!.id).toBe("1");
    expect(val2!.id).toBe("2");
    expect(val3!.id).toBe("3");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: stores and retrieves plain objects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    interface StoredChat {
      id: string;
      data: string;
    }

    const store = createDiskStore<StoredChat>(dir, "id");

    const locked = await store.lock("1");
    await locked.set({ id: "1", data: "test" });
    await locked.release();

    // Read from disk
    const diskContent = readFileSync(join(dir, "1.json"), "utf-8");
    const parsed = JSON.parse(diskContent);
    expect(parsed.id).toBe("1");
    expect(parsed.data).toBe("test");

    // Get returns the same object
    const value = await store.get("1");
    expect(value!.id).toBe("1");
    expect(value!.data).toBe("test");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStoreWatcher: onChange fires when files change", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store1 = createDiskStore<ChatLike>(dir, "id");
    const store2 = createDiskStore<ChatLike>(dir, "id");
    const watcher = createDiskStoreWatcher<ChatLike>(dir);

    const events: Array<{
      key: string;
      value: ChatLike | undefined;
      locked: boolean;
      pid?: number;
    }> = [];
    const unsubscribe = watcher.onChange((event) => {
      events.push(event);
    });

    // Give watcher time to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Store1 makes changes
    const locked = await store1.lock("1");
    await locked.set(makeChat("1"));
    await locked.release();

    // Wait for file system event to propagate
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(events.length).toBeGreaterThan(0);
    const event = events[events.length - 1]!; // Get last event (after unlock)
    expect(event.key).toBe("1");
    expect(event.value).toBeDefined();
    expect(event.value!.id).toBe("1");
    expect(event.locked).toBe(false); // Should be unlocked after release

    // Clean up
    unsubscribe();
    watcher.dispose();
    store1.dispose();
    store2.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStoreWatcher: onChange detects deletes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store1 = createDiskStore<ChatLike>(dir, "id");
    const store2 = createDiskStore<ChatLike>(dir, "id");

    const locked1 = await store1.lock("1");
    await locked1.set(makeChat("1"));
    await locked1.release();

    const watcher = createDiskStoreWatcher<ChatLike>(dir);
    const events: Array<{
      key: string;
      value: ChatLike | undefined;
      locked: boolean;
      pid?: number;
    }> = [];
    const unsubscribe = watcher.onChange((event) => {
      events.push(event);
    });

    // Give watcher time to initialize and catch initial state
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Store1 deletes
    const lockedDel = await store1.lock("1");
    await lockedDel.delete();
    await lockedDel.release();

    // Wait for file system event to propagate (need to wait for poll)
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(events.length).toBeGreaterThan(0);
    const deleteEvent = events.find(
      (e) => e.key === "1" && e.value === undefined
    );
    expect(deleteEvent).toBeDefined();
    expect(deleteEvent!.locked).toBe(false); // Deleted entries are not locked

    // Clean up
    unsubscribe();
    watcher.dispose();
    store1.dispose();
    store2.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStoreWatcher: onChange can be unsubscribed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");
    const watcher = createDiskStoreWatcher<ChatLike>(dir);

    let callCount = 0;
    const unsubscribe = watcher.onChange(() => {
      callCount++;
    });

    // Give watcher time to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    const locked1 = await store.lock("1");
    await locked1.set(makeChat("1"));
    await locked1.release();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const countAfterFirst = callCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Unsubscribe
    unsubscribe();

    // Make another change
    const locked2 = await store.lock("2");
    await locked2.set(makeChat("2"));
    await locked2.release();
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Count should not have increased
    expect(callCount).toBe(countAfterFirst);

    watcher.dispose();
    store.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: lock force option retries more aggressively", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store1 = createDiskStore<ChatLike>(dir, "id");
    const store2 = createDiskStore<ChatLike>(dir, "id");

    const locked1 = await store1.lock("1");
    await locked1.set(makeChat("1"));

    // Spawn async task that releases after a short delay
    setTimeout(async () => {
      await locked1.release();
    }, 200);

    // Force lock should retry and eventually succeed
    const start = Date.now();
    const locked2 = await store2.lock("1", { force: true });
    const elapsed = Date.now() - start;

    // Should have waited for the lock to be released
    expect(elapsed).toBeGreaterThanOrEqual(100);

    await locked2.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: list returns entry metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    // Create two chats
    const locked1 = await store.lock("1");
    await locked1.set(makeChat("1"));
    await locked1.release();

    const locked2 = await store.lock("2");
    await locked2.set(makeChat("2"));
    await locked2.release();

    const entries = await store.list();
    expect(entries.length).toBe(2);

    // Verify all entries have required fields
    for (const entry of entries) {
      expect(entry.key).toBeDefined();
      expect(typeof entry.locked).toBe("boolean");
      expect(entry.mtime).toBeGreaterThan(0);
      // pid is optional and only present when locked
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStore: list returns entries sorted by mtime descending", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");

    // Create chats with delays to ensure different mtimes
    const locked1 = await store.lock("1");
    await locked1.set(makeChat("1"));
    await locked1.release();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const locked2 = await store.lock("2");
    await locked2.set(makeChat("2"));
    await locked2.release();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const locked3 = await store.lock("3");
    await locked3.set(makeChat("3"));
    await locked3.release();

    const entries = await store.list();
    expect(entries.length).toBe(3);

    // Should be sorted by mtime descending (most recent first)
    expect(entries[0]!.key).toBe("3");
    expect(entries[1]!.key).toBe("2");
    expect(entries[2]!.key).toBe("1");

    // Verify mtimes are descending
    expect(entries[0]!.mtime).toBeGreaterThanOrEqual(entries[1]!.mtime);
    expect(entries[1]!.mtime).toBeGreaterThanOrEqual(entries[2]!.mtime);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DiskStoreWatcher: onChange detects lock status changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-diskstore-"));
  try {
    const store = createDiskStore<ChatLike>(dir, "id");
    const watcher = createDiskStoreWatcher<ChatLike>(dir);

    const events: Array<{
      key: string;
      value: ChatLike | undefined;
      locked: boolean;
      pid?: number;
    }> = [];
    const unsubscribe = watcher.onChange((event) => {
      events.push(event);
    });

    // Give watcher time to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Lock the chat (should emit locked: true)
    const locked = await store.lock("test");
    await locked.set(makeChat("test"));

    // Wait for lock event
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Release the lock (should emit locked: false)
    await locked.release();

    // Wait for unlock event
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(events.length).toBeGreaterThan(1);

    // Should have at least one locked event and one unlocked event
    const lockedEvents = events.filter((e) => e.key === "test" && e.locked);
    const unlockedEvents = events.filter((e) => e.key === "test" && !e.locked);

    expect(lockedEvents.length).toBeGreaterThan(0);
    expect(unlockedEvents.length).toBeGreaterThan(0);

    // The locked event should have a PID
    expect(lockedEvents[0]!.pid).toBeDefined();
    expect(lockedEvents[0]!.pid).toBe(process.pid);

    // Clean up
    unsubscribe();
    watcher.dispose();
    store.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileStore: atomic read and write operations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-filestore-"));
  try {
    const filePath = join(dir, "storage.json");
    const store = createFileStore(filePath);

    // Initial read returns empty string
    const initial = await store.read();
    expect(initial).toBe("");

    // Write some data
    const data = { key1: "value1", key2: "value2" };
    await store.write(JSON.stringify(data, null, 2));

    // Read it back
    const read = await store.read();
    const parsed = JSON.parse(read);
    expect(parsed.key1).toBe("value1");
    expect(parsed.key2).toBe("value2");

    // Concurrent writes (both should succeed, last write wins)
    await Promise.all([
      store.write(JSON.stringify({ key: "first" })),
      store.write(JSON.stringify({ key: "second" })),
    ]);

    const final = await store.read();
    const finalParsed = JSON.parse(final);
    expect(finalParsed.key).toBeDefined();

    store.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileStore: handles concurrent operations gracefully", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blink-filestore-"));
  try {
    const filePath = join(dir, "storage.json");
    const store = createFileStore(filePath);

    // Write initial data
    await store.write(JSON.stringify({ counter: 0 }));

    // Simulate multiple processes trying to update
    const operations = Array.from({ length: 5 }, async (_, i) => {
      const data = await store.read();
      const parsed = JSON.parse(data || "{}");
      parsed.counter = (parsed.counter || 0) + 1;
      parsed[`op${i}`] = true;
      await store.write(JSON.stringify(parsed, null, 2));
    });

    await Promise.all(operations);

    // Last write should be persisted
    const final = await store.read();
    const finalParsed = JSON.parse(final);
    expect(finalParsed).toBeDefined();

    store.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
