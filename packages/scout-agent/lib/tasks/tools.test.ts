import { describe, expect, test, mock, beforeAll, afterAll } from "bun:test";
import * as http from "node:http";
import { CoderTasksClient } from "./client";
import { createTasksTools } from "./tools";

const mockTask = {
  id: "task-1",
  organization_id: "org-1",
  owner_id: "user-1",
  owner_name: "service-account",
  name: "fix-auth-bug",
  display_name: "Fix auth bug",
  template_id: "tmpl-1",
  template_version_id: "tv-1",
  template_name: "tasks-docker",
  template_display_name: "Tasks Docker",
  template_icon: "",
  initial_prompt: "Fix the authentication bug in login.ts",
  status: "active" as const,
  current_state: {
    timestamp: "2025-01-01T00:00:00Z",
    state: "working" as const,
    message: "Analyzing code...",
    uri: "",
  },
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const toolOpts = {
  toolCallId: "test",
  messages: [] as never[],
  abortSignal: new AbortController().signal,
};

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://localhost`);
    const method = req.method!;

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      // POST /api/v2/tasks/:user - create task
      if (method === "POST" && /^\/api\/v2\/tasks\/[^/]+$/.test(url.pathname)) {
        const parsed = JSON.parse(body);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ...mockTask,
            initial_prompt: parsed.input,
            name: parsed.name || "generated-name",
            display_name: parsed.display_name || "Generated Name",
          })
        );
        return;
      }

      // GET /api/v2/tasks/:user/:task/logs
      if (
        method === "GET" &&
        /^\/api\/v2\/tasks\/[^/]+\/[^/]+\/logs$/.test(url.pathname)
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            logs: [
              {
                id: 1,
                content: "Cloning repository...",
                time: "2025-01-01T00:00:00Z",
                type: "output",
              },
              {
                id: 2,
                content: "Running tests...",
                time: "2025-01-01T00:00:01Z",
                type: "output",
              },
            ],
          })
        );
        return;
      }

      // POST /api/v2/tasks/:user/:task/send
      if (
        method === "POST" &&
        /^\/api\/v2\/tasks\/[^/]+\/[^/]+\/send$/.test(url.pathname)
      ) {
        res.writeHead(204);
        res.end();
        return;
      }

      // GET /api/v2/tasks/:user/:task - get task
      if (
        method === "GET" &&
        /^\/api\/v2\/tasks\/[^/]+\/[^/]+$/.test(url.pathname)
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(mockTask));
        return;
      }

      // GET /api/v2/tasks - list tasks
      if (method === "GET" && url.pathname === "/api/v2/tasks") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ tasks: [mockTask], count: 1 }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  baseUrl = `http://localhost:${port}`;
});

afterAll(() => {
  server.close();
});

describe("tasks tools", () => {
  test("create_coder_task creates a task and returns summary", async () => {
    const tools = createTasksTools({
      config: {
        url: baseUrl,
        sessionToken: "test-token",
        defaultTemplateVersionId: "tv-default",
      },
    });

    const result = await tools.create_coder_task.execute!(
      {
        prompt: "Fix the authentication bug in login.ts",
        name: "fix-auth-bug",
        display_name: "Fix auth bug",
      },
      toolOpts
    );
    expect(result).toMatchObject({
      id: "task-1",
      name: "fix-auth-bug",
      status: "active",
    });
    expect((result as { url: string }).url).toContain("/tasks/service-account/fix-auth-bug");
  });

  test("create_coder_task uses default template version when not specified", async () => {
    const tools = createTasksTools({
      config: {
        url: baseUrl,
        sessionToken: "test-token",
        defaultTemplateVersionId: "tv-default",
      },
    });

    const result = await tools.create_coder_task.execute!(
      { prompt: "Do something" },
      toolOpts
    );
    expect(result).toBeDefined();
  });

  test("create_coder_task throws when no template version available", async () => {
    const tools = createTasksTools({
      config: {
        url: baseUrl,
        sessionToken: "test-token",
      },
    });

    await expect(
      tools.create_coder_task.execute!({ prompt: "Do something" }, toolOpts)
    ).rejects.toThrow(
      "No template_version_id provided and no default configured."
    );
  });

  test("list_coder_tasks returns tasks", async () => {
    const tools = createTasksTools({
      config: {
        url: baseUrl,
        sessionToken: "test-token",
      },
    });

    const result = await tools.list_coder_tasks.execute!({}, toolOpts);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "task-1",
      name: "fix-auth-bug",
      status: "active",
    });
  });

  test("get_coder_task returns task details", async () => {
    const tools = createTasksTools({
      config: {
        url: baseUrl,
        sessionToken: "test-token",
      },
    });

    const result = await tools.get_coder_task.execute!(
      { task: "fix-auth-bug" },
      toolOpts
    );
    expect(result).toMatchObject({
      id: "task-1",
      name: "fix-auth-bug",
      status: "active",
      current_state: { state: "working" },
    });
  });

  test("get_coder_task_logs returns logs", async () => {
    const tools = createTasksTools({
      config: {
        url: baseUrl,
        sessionToken: "test-token",
      },
    });

    const result = await tools.get_coder_task_logs.execute!(
      { task: "fix-auth-bug" },
      toolOpts
    );
    expect(result.logs).toHaveLength(2);
    expect(result.logs[0].content).toBe("Cloning repository...");
  });

  test("send_coder_task_input sends input", async () => {
    const tools = createTasksTools({
      config: {
        url: baseUrl,
        sessionToken: "test-token",
      },
    });

    const result = await tools.send_coder_task_input.execute!(
      { task: "fix-auth-bug", input: "Also add tests" },
      toolOpts
    );
    expect(result).toEqual({ success: true });
  });
});

describe("CoderTasksClient", () => {
  test("handles API errors gracefully", async () => {
    const errorServer = http.createServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "unauthorized", detail: "invalid token" }));
    });
    await new Promise<void>((resolve) => {
      errorServer.listen(0, () => resolve());
    });
    const addr = errorServer.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;

    const client = new CoderTasksClient(
      `http://localhost:${port}`,
      "bad-token"
    );
    await expect(client.listTasks()).rejects.toThrow(
      "unauthorized - invalid token"
    );

    errorServer.close();
  });
});
