import { expect, test } from "bun:test";
import { RWLock } from "./rw-lock";

// Note: The actual lock logic is handled by the @rocicorp/lock library.
// These tests verify that our wrapper correctly implements Symbol.asyncDispose
// and that basic read/write lock semantics work as expected.
test("RWLock: write lock blocks readers", async () => {
  const lock = new RWLock();
  const events: string[] = [];

  let writerAcquired: () => void = () => {
    throw new Error("writerAcquired not set");
  };
  let releaseWriter: () => void = () => {
    throw new Error("releaseWriter not set");
  };
  const writerHasAcquired = new Promise<void>((resolve) => {
    writerAcquired = resolve;
  });
  const writerCanRelease = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });

  // Acquire write lock
  const writerPromise = (async () => {
    using writeLock = await lock.write();
    events.push("writer-acquired");
    writerAcquired();
    await writerCanRelease;
    // give a chance for a bug to happen. it shouldn't!
    await new Promise((resolve) => setTimeout(resolve, 10));
    events.push("writer-releasing");
  })();

  // Wait for writer to actually acquire the lock
  await writerHasAcquired;

  // Try to acquire read lock (should wait)
  const readerPromise = (async () => {
    events.push("reader-waiting");
    using readLock = await lock.read();
    events.push("reader-acquired");
  })();

  releaseWriter();

  await Promise.all([writerPromise, readerPromise]);

  // Reader should wait for writer to release
  expect(events).toEqual([
    "writer-acquired",
    "reader-waiting",
    "writer-releasing",
    "reader-acquired",
  ]);
});

test("RWLock: readers block write lock", async () => {
  const lock = new RWLock();
  const events: string[] = [];

  let readerAcquired: () => void = () => {
    throw new Error("readerAcquired not set");
  };
  let releaseReader: () => void = () => {
    throw new Error("releaseReader not set");
  };
  const readerHasAcquired = new Promise<void>((resolve) => {
    readerAcquired = resolve;
  });
  const readerCanRelease = new Promise<void>((resolve) => {
    releaseReader = resolve;
  });

  // Acquire read lock
  const readerPromise = (async () => {
    using readLock = await lock.read();
    events.push("reader-acquired");
    readerAcquired();
    await readerCanRelease;
    // give a chance for a bug to happen. it shouldn't!
    await new Promise((resolve) => setTimeout(resolve, 10));
    events.push("reader-releasing");
  })();

  // Wait for reader to actually acquire the lock
  await readerHasAcquired;

  // Try to acquire write lock (should wait)
  const writerPromise = (async () => {
    events.push("writer-waiting");
    using writeLock = await lock.write();
    events.push("writer-acquired");
  })();

  releaseReader();

  await Promise.all([readerPromise, writerPromise]);

  // Writer should wait for reader to release
  expect(events).toEqual([
    "reader-acquired",
    "writer-waiting",
    "reader-releasing",
    "writer-acquired",
  ]);
});
