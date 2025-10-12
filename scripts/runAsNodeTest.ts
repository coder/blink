export const runAsNodeTest = (name: string, filename: string) => {
  const { test } = require("bun:test");
  test(name, async () => {
    const proc = Bun.spawn(["node", "--test", "--import", "tsx", filename], {
      stdout: "pipe",
      stderr: "pipe",
    });
    let stdout = "";
    let stderr = "";
    const decoder = new TextDecoder();
    proc.stdout.pipeTo(
      new WritableStream({
        write(chunk) {
          stdout += decoder.decode(chunk);
        },
      })
    );
    proc.stderr.pipeTo(
      new WritableStream({
        write(chunk) {
          stderr += decoder.decode(chunk);
        },
      })
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      if (stderr) {
        console.error(stderr);
      }
      if (stdout) {
        console.error(stdout);
      }
      throw new Error(`Test ${name} failed with exit code ${exitCode}`);
    }
  });
};
