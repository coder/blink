export const runAsNodeTest = (
  name: string,
  filename: string,
  options?: { timeoutMs?: number }
) => {
  const { test } = require("bun:test");
  test(
    name,
    options?.timeoutMs ? { timeout: options.timeoutMs } : {},
    async () => {
      const proc = Bun.spawn(["node", "--test", "--import", "tsx", filename], {
        stdout: "inherit",
        stderr: "inherit",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`Test ${name} failed with exit code ${exitCode}`);
      }
    }
  );
};
