/**
 * Request-scoped context for authentication tokens using AsyncLocalStorage.
 *
 * This solves the race condition where concurrent requests would overwrite
 * each other's auth tokens when stored in global environment variables.
 *
 * Usage:
 *   - Wrappers call `runWithAuth(token, fn)` to establish context
 *   - Consumers call `getAuthToken()` to retrieve the request's token
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  authToken: string;
}

// Use a Symbol to create a unique global key that won't collide with other properties.
// This ensures all copies of this module (bundled or external) share the same ALS instance.
const BLINK_AUTH_CONTEXT_KEY = Symbol.for("@blink/authContext");

/**
 * Get or create the global AsyncLocalStorage instance.
 * Using a global singleton ensures that bundled copies of this module
 * share the same ALS instance as external copies.
 */
function getRequestContext(): AsyncLocalStorage<RequestContext> {
  const g = globalThis as typeof globalThis & {
    [BLINK_AUTH_CONTEXT_KEY]?: AsyncLocalStorage<RequestContext>;
  };

  if (!g[BLINK_AUTH_CONTEXT_KEY]) {
    g[BLINK_AUTH_CONTEXT_KEY] = new AsyncLocalStorage<RequestContext>();
  }

  return g[BLINK_AUTH_CONTEXT_KEY];
}

/**
 * AsyncLocalStorage instance for request-scoped context.
 * Each async execution flow gets its own isolated store.
 */
export const requestContext = getRequestContext();

/**
 * Get the auth token for the current request context.
 * Returns undefined if called outside of a runWithAuth context.
 */
export function getAuthToken(): string | undefined {
  return getRequestContext().getStore()?.authToken;
}

/**
 * Run a function with the given auth token in the request context.
 * All async operations within `fn` will have access to this token.
 */
export function runWithAuth<T>(authToken: string, fn: () => T): T {
  return getRequestContext().run({ authToken }, fn);
}
