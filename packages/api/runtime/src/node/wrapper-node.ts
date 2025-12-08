// The purpose of this file is to wrap the Node.js runtime
// request/resposne handling in a way that is compatible with
// the Blink Agent exports.

import { BlinkInvocationTokenHeader } from "@blink.so/runtime/types";
import http from "http";
import { resolve } from "node:path";
import { startAgentServer, startInternalAPIServer } from "../server";

const { setAuthToken, server } = startInternalAPIServer();
server.unref();

if (!process.env.ENTRYPOINT) {
  throw new Error("developer error: ENTRYPOINT is not set");
}

const port = process.env.PORT ? parseInt(process.env.PORT) : 12345;
const agent = await startAgentServer(resolve(process.env.ENTRYPOINT), port + 1);

http
  .createServer((req, res) => {
    setAuthToken(req.headers[BlinkInvocationTokenHeader] as string);
    agent(req, res);
  })
  .listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
