import { RWLock as RocicorpRWLock } from "@rocicorp/lock";

export class ReadLock {
  constructor(private onRelease: () => void) {}

  [Symbol.dispose](): void {
    this.onRelease();
  }
}

export class WriteLock {
  constructor(private onRelease: () => void) {}

  [Symbol.dispose](): void {
    this.onRelease();
  }
}

/**
 * RWLock is a read/write lock that allows multiple concurrent readers
 * or a single writer. Writers wait for all readers to finish before acquiring
 * the lock.
 *
 * This is designed for in-memory, single-process synchronization using the
 * explicit resource management pattern (Symbol.dispose).
 *
 * Example usage:
 * ```typescript
 * const lock = new RWLock();
 *
 * // Multiple readers can acquire the lock concurrently
 * using readLock = await lock.read();
 * // ... do read operations ...
 *
 * // Writers wait for all readers to finish
 * using writeLock = await lock.write();
 * // ... do write operations ...
 * ```
 */
export class RWLock {
  private _lock = new RocicorpRWLock();

  /**
   * Acquire a read lock. Multiple readers can hold the lock concurrently.
   * If a writer is waiting, new readers will wait until the writer completes.
   *
   * The lock is automatically released when the returned object is disposed.
   */
  async read(): Promise<ReadLock> {
    const release = await this._lock.read();
    return new ReadLock(release);
  }

  /**
   * Acquire a write lock. Waits for all readers to finish before acquiring.
   * Only one writer can hold the lock at a time.
   *
   * The lock is automatically released when the returned object is disposed.
   */
  async write(): Promise<WriteLock> {
    const release = await this._lock.write();
    return new WriteLock(release);
  }
}
