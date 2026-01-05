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
      const result = await checkDockerNetworking();

      // If host networking works both ways, hostAddress should be set
      if (result.hostNetwork.containerToHost) {
        expect(result.hostNetwork.hostAddress).not.toBeNull();
      }

      // If port-bind works both ways, hostAddress should be set
      if (result.portBind.containerToHost) {
        expect(result.portBind.hostAddress).not.toBeNull();
      }

      // Verify recommendation is consistent with results
      const hostWorks =
        result.hostNetwork.hostToContainer &&
        result.hostNetwork.containerToHost;
      const bridgeWorks =
        result.portBind.hostToContainer && result.portBind.containerToHost;

      if (hostWorks && bridgeWorks) {
        expect(result.recommended).toBe("both");
      } else if (hostWorks) {
        expect(result.recommended).toBe("host");
      } else if (bridgeWorks) {
        expect(result.recommended).toBe("port-bind");
      } else {
        expect(result.recommended).toBe("none");
      }
    },
    { timeout: 30000 }
  );
});
