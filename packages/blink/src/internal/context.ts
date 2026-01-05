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

/**
 * AsyncLocalStorage instance for request-scoped context.
 * Each async execution flow gets its own isolated store.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Get the auth token for the current request context.
 * Returns undefined if called outside of a runWithAuth context.
 */
export function getAuthToken(): string | undefined {
  return requestContext.getStore()?.authToken;
}

/**
 * Run a function with the given auth token in the request context.
 * All async operations within `fn` will have access to this token.
 */
export function runWithAuth<T>(authToken: string, fn: () => T): T {
  return requestContext.run({ authToken }, fn);
}
