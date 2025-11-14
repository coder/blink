import { Server, type ServerOptions } from "@blink-sdk/compute-protocol/server";
import { Emitter } from "@blink-sdk/events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";

const defaultEnvVariables = {
  // These are so Blink can use commits to GitHub properly.
  GIT_TERMINAL_PROMPT: "0",
  GIT_PAGER: "cat",
  GIT_AUTHOR_NAME: "blink-so[bot]",
  GIT_AUTHOR_EMAIL: "211532188+blink-so[bot]@users.noreply.github.com",
  GIT_COMMITTER_NAME: "blink-so[bot]",
  GIT_COMMITTER_EMAIL: "211532188+blink-so[bot]@users.noreply.github.com",

  // The `gh` CLI is required to be in the workspace.
  // Eventually, we should move this credential helper to just be in the Blink CLI.
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
  GIT_CONFIG_VALUE_0: "!gh auth git-credential",
};

export default async function serveCompute() {
  for (const [key, value] of Object.entries(defaultEnvVariables)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const port = parseInt(process.env.PORT ?? "22137");
  if (isNaN(port)) {
    throw new Error("PORT environment variable is not a number");
  }

  const wss = new WebSocketServer({ port });

  console.log(`Compute server running on port ${port}`);

  wss.on("connection", (ws) => {
    console.log("Client connected");

    let nodePty: typeof import("@lydell/node-pty") | undefined;
    try {
      nodePty = require("@lydell/node-pty");
    } catch (e) {
      // It's fine, we don't _need_ to use TTYs.
    }
    if (typeof Bun !== "undefined") {
      nodePty = undefined;
    }

    const server = new Server({
      nodePty,
      send: (message: Uint8Array) => {
        // Send binary data to the WebSocket client
        ws.send(message);
      },
    });

    ws.on("message", (data: Buffer) => {
      // Forward WebSocket messages to the server
      server.handleMessage(new Uint8Array(data));
    });

    ws.on("close", () => {
      console.log("Client disconnected");
    });
  });
}
