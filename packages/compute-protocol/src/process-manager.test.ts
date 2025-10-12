import { it, test } from "node:test";
import { runAsNodeTest } from "../../../scripts/runAsNodeTest";
import { ProcessManager } from "./process-manager";

if (typeof Bun !== "undefined") {
  // Unfortunately, these tests have to use Node.
  // Bun does not support the `node-pty` package.
  runAsNodeTest("process-manager", __filename);
} else {
  test("should buffer basic output", async () => {
    const nodePty = await import("@lydell/node-pty");
    const processManager = new ProcessManager({ nodePty });
    const process = await processManager.execute("bash", ["-c", "echo test"]);

    await new Promise<any>((resolve) => {
      process.onExit(resolve);
    });
    expect(processManager.readANSIOutput(process.pid), "test\x1b[1B\x1b[4D");
    expect(
      processManager.readPlainOutput(process.pid, 0, 1).lines.join(""),
      "test"
    );
  });

  test("read long output", async () => {
    const nodePty = await import("@lydell/node-pty");
    const processManager = new ProcessManager({ nodePty });
    const process = await processManager.execute("bash", [
      "-c",
      "for i in {1..100}; do echo $i; done",
    ]);
    await new Promise<any>((resolve) => {
      process.onExit(resolve);
    });
    expect(
      processManager.readPlainOutput(process.pid, 0, 100).lines,
      Array.from({ length: 100 }, (_, i) => `${i + 1}`)
    );
    const status = processManager.status(process.pid);
    expect(status.output_total_lines, 100);
    expect(status.exit_code, 0);
    expect(status.exit_signal, 0);
    if (status.duration_ms === 0) {
      throw new Error("Duration is 0");
    }
    expect(status.command, "bash");
    expect(status.args, ["-c", "for i in {1..100}; do echo $i; done"]);
    expect(status.cwd, "");
    expect(status.env, {});
    expect(status.pid, process.pid);

    await it("should seek plain output", () => {
      const result = processManager.readPlainOutput(process.pid, 51, 51);
      expect(result.lines, ["51"]);
      expect(result.totalLines, 100);
    });

    await it("should read zero lines passing the end", () => {
      const result = processManager.readPlainOutput(process.pid, 105, 106);
      expect(result.lines, []);
      expect(result.totalLines, 100);
    });
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
