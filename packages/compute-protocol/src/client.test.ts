import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import path from "path";
import { runAsNodeTest } from "../../../scripts/runAsNodeTest";
import { createInMemoryClientServer } from "./transport";
import * as pty from "@lydell/node-pty";

if (typeof Bun !== "undefined") {
  // Unfortunately, these tests have to use Node.
  // Bun does not support the `node-pty` package.
  runAsNodeTest("client", __filename);
} else {
  test("catches errors for failed requests", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });
    let caught: Error | undefined;
    try {
      await client.request("read_file", {
        path: "/tmp",
      });
    } catch (err) {
      caught = err as Error;
    }
    if (!caught) {
      throw new Error("Expected an error");
    }
    if (!caught.message.startsWith("EISDIR")) {
      throw new Error("Expected EISDIR");
    }
  });

  test("executes", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });

    const exec = await client.request("process_execute", {
      command: "echo",
      args: ["test"],
    });
    let output: string = "";
    client.onNotification("process_output", (payload) => {
      output += payload.output;
    });
    const response = await client.request("process_wait", {
      pid: exec.pid,
    });
    expect(response.exit_code, 0);
    expect(response.exit_signal, 0);
    if (response.duration_ms === 0) {
      throw new Error("Duration is 0");
    }
    expect(response.ansi_output, "test\u001b[1B\u001b[4D");
    expect(response.plain_output, {
      lines: ["test"],
      total_lines: 1,
    });
    expect(output, "test\r\n");
  });

  test("execute with output timeout", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });

    const exec = await client.request("process_execute", {
      command: "bash",
      args: ["-c", "echo first && sleep 1 && echo second"],
    });
    let output: string = "";
    client.onNotification("process_output", (payload) => {
      output += payload.output;
    });
    const response = await client.request("process_wait", {
      pid: exec.pid,
      output_idle_timeout_ms: 100,
    });
    expect(output, "first\r\n");
    // The command is still running, so we should not have an exit code or signal.
    expect(response.exit_code, undefined);
    expect(response.exit_signal, undefined);
    if (response.duration_ms === 0) {
      throw new Error("Duration is 0");
    }
    expect(response.ansi_output, "first\u001b[1B\u001b[5D");
    expect(response.plain_output, {
      lines: ["first"],
      total_lines: 1,
    });

    await client.request("process_kill", {
      pid: exec.pid,
      signal: "SIGTERM",
    });
  });

  test("execute with timeout", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });

    const exec = await client.request("process_execute", {
      command: "bash",
      args: ["-c", "echo test && sleep 1"],
    });
    let output: string = "";
    client.onNotification("process_output", (payload) => {
      output += payload.output;
    });
    const response = await client.request("process_wait", {
      pid: exec.pid,
      timeout_ms: 100,
    });
    expect(output, "test\r\n");
    expect(response.exit_code, undefined);
    expect(response.exit_signal, undefined);
    if (response.duration_ms === 0) {
      throw new Error("Duration is 0");
    }
    expect(response.ansi_output, "test\u001b[1B\u001b[4D");
    expect(response.plain_output, {
      lines: ["test"],
      total_lines: 1,
    });

    await client.request("process_kill", {
      pid: exec.pid,
      signal: "SIGTERM",
    });
  });

  test("send input to process", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });

    const exec = await client.request("process_execute", {
      command: "bash",
      args: ["-c", "read line; echo $line"],
    });
    let output: string = "";
    client.onNotification("process_output", (payload) => {
      output += payload.output;
    });
    await client.request("process_send_input", {
      pid: exec.pid,
      data: "test\n",
    });
    const response = await client.request("process_wait", {
      pid: exec.pid,
    });
    expect(output, "test\r\ntest\r\n");
    expect(response.exit_code, 0);
    expect(response.exit_signal, 0);
    expect(response.ansi_output, "test\r\ntest\u001b[1B\u001b[4D");
    expect(response.plain_output, {
      lines: ["test", "test"],
      total_lines: 2,
    });
  });

  test("read output after process exits", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });

    const exec = await client.request("process_execute", {
      command: "bash",
      args: ["-c", "for i in {1..100}; do echo $i; done"],
    });
    const response = await client.request("process_wait", {
      pid: exec.pid,
    });
    expect(response.exit_code, 0);
    expect(response.exit_signal, 0);
    expect(response.output_total_lines, 100);
    expect(response.plain_output, {
      lines: Array.from({ length: 100 }, (_, i) => `${i + 1}`),
      total_lines: 100,
    });
    let output: string = "";
    client.onNotification("process_output", (payload) => {
      output += payload.output;
    });
    const readResponse = await client.request("process_read_plain_output", {
      pid: exec.pid,
      start_line: 1,
      end_line: 2,
    });
    expect(readResponse.lines, ["1", "2"]);
    expect(readResponse.total_lines, 100);
  });

  test("kill process", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });
    const exec = await client.request("process_execute", {
      command: "bash",
      args: ["-c", "sleep infinity"],
    });
    await client.request("process_kill", {
      pid: exec.pid,
      signal: "SIGTERM",
    });
    const response = await client.request("process_wait", {
      pid: exec.pid,
    });
    expect(response.exit_code, 0);
    expect(response.exit_signal, 15);
  });

  test("set env", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });
    await client.request("set_env", {
      env: {
        TEST: "test",
      },
    });
    const exec = await client.request("process_execute", {
      command: "bash",
      args: ["-c", "echo $TEST"],
    });
    const response = await client.request("process_wait", {
      pid: exec.pid,
    });
    expect(response.exit_code, 0);
    expect(response.exit_signal, 0);
    expect(response.plain_output, {
      lines: ["test"],
      total_lines: 1,
    });
  });

  test("write file", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });
    const filePath = await createTempFile("hello\nworld");
    await client.request("write_file", {
      path: filePath,
      content: "new\ncontent",
    });
    const response = await client.request("read_file", {
      path: filePath,
    });
    expect(response.content, "new\ncontent");
  });

  test("list processes", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });
    const exec = await client.request("process_execute", {
      command: "bash",
      args: ["-c", "sleep infinity"],
    });
    const response = await client.request("process_list", {
      include_dead: true,
    });
    expect(response.processes.length, 1);
    expect(response.processes[0]!.command, "bash");
    expect(response.processes[0]!.args, ["-c", "sleep infinity"]);
    expect(response.processes[0]!.exit_code, undefined);
    expect(response.processes[0]!.output_total_lines, 0);

    await client.request("process_kill", {
      pid: exec.pid,
      signal: "SIGTERM",
    });
  });

  test("read directory", async () => {
    const { client } = createInMemoryClientServer({ nodePty: pty });
    const response = await client.request("read_directory", {
      path: "/tmp",
    });
    if (response.entries.length <= 0) {
      throw new Error("Expected at least one entry");
    }
  });
}

const expect = (actual: any, expected: any) => {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    console.log("actual", actualStr);
    console.log("expected", expectedStr);
    throw new Error(`Expected ${expectedStr} but got ${actualStr}`);
  }
};

const createTempFile = async (content: string) => {
  const tmpDir = tmpdir();
  const fileName = randomUUID();
  const filePath = path.join(tmpDir, "runner-test-" + fileName);
  await writeFile(filePath, content);
  return filePath;
};
