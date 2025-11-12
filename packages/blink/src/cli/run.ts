import { join, resolve } from "node:path";
import { ChatManager } from "../local/chat-manager";
import { spawnAgent } from "../local/spawn-agent";
import { parse } from "dotenv";
import { readFile } from "node:fs/promises";
import { getAuthToken } from "./lib/auth";
import { migrateDataToBlink } from "./lib/migrate";
import { resolveConfig } from "../build";
import { findNearestEntry } from "../build/util";
import { existsSync } from "node:fs";
import type { ID } from "../agent/types";
import { RWLock } from "../local/rw-lock";

export default async function run(
  message: string[],
  opts: { directory?: string; chat?: ID } = {}
) {
  if (!opts.directory) {
    const cwd = process.cwd();

    // Try to resolve config in current directory
    try {
      resolveConfig(cwd);
      opts.directory = cwd;
    } catch {
      // No agent found in current directory, search upward for .blink
      let dotBlinkPath = await findNearestEntry(cwd, ".blink");

      // This is legacy behavior to migrate old Blink directories to the new .blink/ directory.
      if (dotBlinkPath && existsSync(join(dotBlinkPath, "build"))) {
        dotBlinkPath = undefined;
      }

      if (dotBlinkPath) {
        opts.directory = dotBlinkPath;
      } else {
        // Use the current working directory
        opts.directory = cwd;
      }
    }
  }

  // Auto-migrate data/ to .blink/ if it exists
  await migrateDataToBlink(opts.directory);

  const config = resolveConfig(opts.directory);

  let env = {};
  try {
    env = parse(await readFile(join(opts.directory, ".env.local"), "utf-8"));
  } catch (err) {
    // noop
  }
  const token = await getAuthToken();
  const agent = await spawnAgent({
    command: "node",
    args: ["--experimental-strip-types", "--no-deprecation", config.entry],
    env: {
      ...process.env,
      ...env,
      BLINK_TOKEN: token,
    },
  });
  console.log("Agent spawned");

  const chatsDir = resolve(opts?.directory ?? process.cwd(), ".blink", "chats");

  const manager = new ChatManager({
    chatId: opts?.chat,
    chatsDirectory: chatsDir,
    onError: (error) => {
      console.error("Error:", error);
    },
  });
  manager.setAgent({ client: agent.client, lock: new RWLock() });

  try {
    // Wait for completion by subscribing to state changes
    const promise = new Promise<void>((resolve) => {
      const unsubscribe = manager.subscribe((state) => {
        if (state.status === "idle" || state.status === "error") {
          unsubscribe();
          resolve();
        }
      });
    });
    // Send the user message
    await manager.sendMessages([
      {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        metadata: undefined,
        parts: [{ type: "text", text: message.join(" ") }],
        role: "user",
        mode: "run",
      },
    ]);
    await promise;

    // Print final state
    const finalState = manager.getState();
    console.log("Final state:", finalState.messages.pop());
  } finally {
    manager.dispose();
    agent.dispose();
  }
}
