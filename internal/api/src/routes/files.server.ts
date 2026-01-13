import { validator } from "hono/validator";
import { MESSAGE_LIMITS } from "../constants";
import type { APIServer } from "../server";
import { withToolsAuth } from "./tools/tools.server";

export default function mountFiles(server: APIServer) {
  // Upload file.
  server.post(
    "/",
    withToolsAuth(),
    validator("form", (value, c) => {
      const file = value["file"];
      if (!file) {
        return c.json({ message: "No file provided" }, 400);
      }
      if (!(file instanceof File)) {
        return c.json({ message: "File is not a File" }, 400);
      }
      if (file.size > MESSAGE_LIMITS.MAX_FILE_UPLOAD_SIZE_BYTES) {
        return c.json(
          {
            message: `File is too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum allowed: ${Math.round(MESSAGE_LIMITS.MAX_FILE_UPLOAD_SIZE_BYTES / 1024 / 1024)}MB`,
          },
          413
        );
      }
      return file;
    }),
    async (c) => {
      const file = c.req.valid("form");
      const { id, url } = await c.env.files.upload({
        user_id: c.get("user_id"),
        agent_id: c.get("agent_id"),
        file,
      });
      return c.json({ id, url }, 201);
    }
  );

  server.get("/:id", async (c) => {
    const id = c.req.param("id");
    const file = await c.env.files.download(id);

    // Don't set Content-Length header. Bun has a bug where it modifies certain content
    // types during transmission (e.g., stripping trailing newlines from JSON files),
    // causing a mismatch between Content-Length and actual bytes sent. This makes the
    // client hang waiting for bytes that never arrive. Omitting Content-Length forces
    // chunked transfer encoding which avoids the issue.
    // Note: this happens with createServer from node:http, not with Bun.serve.
    return c.body(file.stream, 200, {
      "Content-Type": file.type,
      // Inline to prevent the browser from downloading the file.
      "Content-Disposition": `inline; filename="${file.name}"`,
    });
  });
}
