import { afterEach, beforeEach, expect, test } from "bun:test";
import { render } from "ink";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React, { useEffect } from "react";
import useAuth, { type UseAuth } from "./use-auth";

// Test harness component
type HarnessProps = {
  autoCheck?: boolean;
  testAuthPath: string;
  onUpdate: (result: UseAuth) => void;
};

const Harness: React.FC<HarnessProps> = ({
  autoCheck,
  testAuthPath,
  onUpdate,
}) => {
  const result = useAuth({ autoCheck, testAuthPath });
  useEffect(() => {
    onUpdate(result);
  }, [result.user, result.token, result.error]);
  return null;
};

// Observer for hook state
function createObserver() {
  let latest: UseAuth | undefined;
  let resolvers: Array<(r: UseAuth) => void> = [];
  const onUpdate = (r: UseAuth) => {
    latest = r;
    const toResolve = resolvers;
    resolvers = [];
    for (const resolve of toResolve) resolve(r);
  };
  const next = () =>
    new Promise<UseAuth>((resolve) => {
      resolvers.push(resolve);
    });
  const waitFor = async (
    predicate: (r: UseAuth) => boolean,
    timeoutMs = 2000
  ) => {
    const start = Date.now();
    if (latest && predicate(latest)) return latest;
    while (Date.now() - start < timeoutMs) {
      const r = await next();
      if (predicate(r)) return r;
    }
    throw new Error("waitFor timed out");
  };
  const getLatest = () => latest as UseAuth;
  return { onUpdate, waitFor, getLatest };
}

let tempDir: string;
let testAuthPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "blink-useauth-"));
  testAuthPath = join(tempDir, "auth.json");
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("initializes and loads token from disk", async () => {
  const { onUpdate, getLatest } = createObserver();
  const app = render(
    <Harness autoCheck={true} testAuthPath={testAuthPath} onUpdate={onUpdate} />
  );

  try {
    // Wait for initial check
    await new Promise((resolve) => setTimeout(resolve, 300));
    const result = getLatest();
    // No token should exist in test directory
    expect(result.token).toBeUndefined();
    expect(result.user).toBeUndefined();
  } finally {
    app.unmount();
  }
});

test("initializes without auto-check", async () => {
  const { onUpdate, getLatest } = createObserver();
  const app = render(
    <Harness
      autoCheck={false}
      testAuthPath={testAuthPath}
      onUpdate={onUpdate}
    />
  );

  try {
    // Give it a moment to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = getLatest();
    // Token is loaded from disk even without auto-check, but test dir is empty
    expect(result.token).toBeUndefined();
  } finally {
    app.unmount();
  }
});

test("provides login and logout methods", async () => {
  const { onUpdate, getLatest } = createObserver();
  const app = render(
    <Harness
      autoCheck={false}
      testAuthPath={testAuthPath}
      onUpdate={onUpdate}
    />
  );

  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const result = getLatest();
    expect(typeof result.login).toBe("function");
    expect(typeof result.logout).toBe("function");
  } finally {
    app.unmount();
  }
});

test("logout clears auth state", async () => {
  const { onUpdate, getLatest } = createObserver();
  const app = render(
    <Harness
      autoCheck={false}
      testAuthPath={testAuthPath}
      onUpdate={onUpdate}
    />
  );

  try {
    // Wait for init
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Call logout to clear state
    const result = getLatest();
    result.logout();

    // Auth should be cleared
    await new Promise((resolve) => setTimeout(resolve, 100));
    const afterLogout = getLatest();
    expect(afterLogout.user).toBeUndefined();
    expect(afterLogout.token).toBeUndefined();
  } finally {
    app.unmount();
  }
});
