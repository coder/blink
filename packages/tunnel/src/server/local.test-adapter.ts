/**
 * Test adapter for the local tunnel server.
 */

import type { TestServer, TestServerFactory } from "../test-utils";
import { createLocalServer } from "./local";

let portCounter = 17000;

/**
 * Create a local server for testing.
 */
export function createLocalTestServer(secret: string): TestServer {
  const port = portCounter++;
  const server = createLocalServer({
    port,
    secret,
    baseUrl: `http://localhost:${port}`,
    mode: "subpath",
  });

  return {
    url: `http://localhost:${port}`,
    secret,
    close: () => server.close(),
  };
}

/**
 * Factory for creating local test servers.
 */
export const createLocalServerFactory = (secret: string): TestServerFactory => {
  return async () => createLocalTestServer(secret);
};
