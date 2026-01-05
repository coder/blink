// The purpose of this file is to wrap the Node.js runtime
// request/response handling in a way that is compatible with
// the Blink Agent exports.

import { BlinkInvocationTokenHeader } from "@blink.so/runtime/types";
import { runWithAuth } from "blink/internal";
import http from "http";
import { resolve } from "node:path";
import { startAgentServer, startInternalAPIServer } from "../server";

const { server, setAuthToken } = startInternalAPIServer();
server.unref();

if (!process.env.ENTRYPOINT) {
  throw new Error("developer error: ENTRYPOINT is not set");
}

const port = process.env.PORT ? parseInt(process.env.PORT) : 12345;
const agent = await startAgentServer(resolve(process.env.ENTRYPOINT), port + 1);

http
  .createServer((req, res) => {
    const authToken = req.headers[BlinkInvocationTokenHeader] as string;
    // Set auth token for the internal API server (closure-based for HTTP boundary crossing)
    setAuthToken(authToken);
    // Use AsyncLocalStorage to ensure each request has its own auth context
    // This is used by model() and other code that runs directly in the request context
    runWithAuth(authToken, () => {
      agent(req, res);
    });
  })
  .listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
