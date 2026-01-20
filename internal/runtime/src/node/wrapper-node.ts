// The purpose of this file is to wrap the Node.js runtime
// request/response handling in a way that is compatible with
// the Blink Agent exports.

import {
  BlinkInvocationAuthTokenEnvironmentVariable,
  BlinkInvocationTokenHeader,
} from "@blink.so/runtime/types";
import { runWithAuth } from "blink/internal";
import http from "http";
import { resolve } from "node:path";
import {
  patchFetchWithAuth,
  startAgentServer,
  startInternalAPIServer,
} from "../server";

const { server: internalServer, port: internalPort } =
  await startInternalAPIServer();
internalServer.unref();
patchFetchWithAuth(`http://127.0.0.1:${internalPort}`);

if (!process.env.ENTRYPOINT) {
  throw new Error("developer error: ENTRYPOINT is not set");
}

const listenPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 12345;
const { handler: agent } = await startAgentServer(
  resolve(process.env.ENTRYPOINT),
  0
);

const httpServer = http.createServer((req, res) => {
  const authToken = req.headers[BlinkInvocationTokenHeader] as string;

  // Legacy: Set env var for older blink package versions that don't use ALS.
  // WARNING: This has race conditions with concurrent requests - it's here
  // only for backwards compatibility. New blink versions use ALS context.
  process.env[BlinkInvocationAuthTokenEnvironmentVariable] = authToken;

  // Use AsyncLocalStorage to ensure each request has its own auth context.
  // The patched fetch will read from this context when making internal API requests.
  runWithAuth(authToken, () => {
    agent(req, res);
  });
});

httpServer.listen(listenPort, () => {
  const address = httpServer.address();
  const actualPort =
    address && typeof address !== "string" ? address.port : listenPort;
  console.log(`BLINK_EXTERNAL_PORT:${actualPort}`);
  console.log(`Server is running on port ${actualPort}`);
});
