/**
 * Internal blink module - not for public consumption.
 * Used by runtime wrappers to share request-scoped context.
 */
export { getAuthToken, runWithAuth, requestContext } from "./context";
export type { RequestContext } from "./context";
