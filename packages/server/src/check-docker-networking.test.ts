import { describe, expect, test } from "bun:test";
import { checkDockerNetworking } from "./check-docker-networking";

async function isDockerAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["docker", "info"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

describe("checkDockerNetworking", async () => {
  const dockerAvailable = await isDockerAvailable();

  test.skipIf(!dockerAvailable)(
    "should detect networking capabilities",
    async () => {
      const accessUrl = process.env.BLINK_ACCESS_URL ?? "https://example.com";
      const result = await checkDockerNetworking(accessUrl);

      // If port-bind works both ways, hostAddress should be set
      if (result.portBind.containerToHost) {
        expect(result.portBind.hostAddress).not.toBeNull();
      }

      // Verify recommendation is consistent with results
      const portBindWorks =
        result.portBind.hostToContainer &&
        (result.portBind.containerToHost || result.accessUrl.reachable);

      if (portBindWorks) {
        expect(result.recommended).toBe("port-bind");
      } else {
        expect(result.recommended).toBe("none");
      }
    },
    { timeout: 30000 }
  );
});
