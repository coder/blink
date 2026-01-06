import { spawn } from "node:child_process";
import http from "node:http";

export interface NetworkingTestResult {
  hostNetwork: {
    hostToContainer: boolean;
    containerToHost: boolean;
    hostAddress: string | null;
  };
  portBind: {
    hostToContainer: boolean;
    containerToHost: boolean;
    hostAddress: string | null;
  };
  recommended: "host" | "port-bind" | "both" | "none";
}

let cachedPromise: Promise<NetworkingTestResult> | null = null;

/**
 * Get the cached networking test result, or run the test if not cached.
 */
export async function getDockerNetworkingConfig(): Promise<NetworkingTestResult> {
  if (!cachedPromise) {
    cachedPromise = checkDockerNetworking();
  }
  return cachedPromise;
}

function startHostServer(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ source: "host" }));
    });
    server.listen(0, "0.0.0.0", () => {
      const addr = server.address();
      const port = typeof addr === "object" ? addr?.port : 0;
      resolve({ server, port: port! });
    });
  });
}

function execDocker(
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn("docker", args, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });
}

async function dockerRun(
  name: string,
  args: string[],
  script: string
): Promise<void> {
  // Pre-cleanup in case a previous run left this container behind
  await dockerRm(name);

  const { code, stderr } = await execDocker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    ...args,
    "node:alpine",
    "node",
    "-e",
    script,
  ]);

  if (code !== 0) {
    throw new Error(`Failed to start container ${name}: ${stderr}`);
  }
}

async function dockerRm(name: string): Promise<void> {
  await execDocker(["rm", "-f", name]);
}

async function getPortFromLogs(
  containerName: string,
  maxAttempts = 10,
  delayMs = 300
): Promise<number | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const { stdout } = await execDocker(["logs", containerName]);
    const match = stdout.match(/BLINK_PORT:(\d+)/);
    if (match?.[1]) {
      return parseInt(match[1], 10);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

async function getPortFromDockerPort(
  containerName: string,
  containerPort: number
): Promise<number | null> {
  const { stdout, code } = await execDocker([
    "port",
    containerName,
    String(containerPort),
  ]);
  if (code !== 0) return null;
  // Output format: "0.0.0.0:32768" or "[::]:32768"
  const match = stdout.match(/:(\d+)\s*$/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

const CONTAINER_SERVER_SCRIPT = `
const http = require("http");
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ source: "container" }));
});
const port = parseInt(process.env.LISTEN_PORT || "0", 10);
server.listen(port, "0.0.0.0", () => {
  const actualPort = server.address().port;
  console.log("BLINK_PORT:" + actualPort);
});
`;

async function testConnection(
  url: string,
  timeoutMs = 2000,
  maxAttempts = 3
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) return true;
    } catch {
      // Continue to next attempt
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

async function testContainerToHost(
  containerName: string,
  hostPort: number,
  isHostNetwork: boolean
): Promise<{ success: boolean; address: string | null }> {
  // Try multiple host addresses
  const hostAddresses = [
    ...(isHostNetwork ? ["127.0.0.1"] : []), // localhost works with host networking
    "host.docker.internal",
    "172.17.0.1", // Common Docker bridge gateway
  ];

  for (const addr of hostAddresses) {
    // Retry each address a few times to handle transient failures
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const script = `
          fetch("http://${addr}:${hostPort}", { signal: AbortSignal.timeout(2000) })
            .then(r => r.text())
            .then(console.log)
            .catch(() => process.exit(1))
        `;
        const { stdout, code } = await execDocker([
          "exec",
          containerName,
          "node",
          "-e",
          script,
        ]);
        if (code === 0 && stdout.includes('"source":"host"')) {
          return { success: true, address: addr };
        }
      } catch {
        // Continue to next attempt
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }
  return { success: false, address: null };
}

export async function checkDockerNetworking(): Promise<NetworkingTestResult> {
  const results: NetworkingTestResult = {
    hostNetwork: {
      hostToContainer: false,
      containerToHost: false,
      hostAddress: null,
    },
    portBind: {
      hostToContainer: false,
      containerToHost: false,
      hostAddress: null,
    },
    recommended: "none",
  };

  // Start host server
  const { server: hostServer, port: hostPort } = await startHostServer();

  const HOST_CONTAINER = "blink-net-test-host";
  const BRIDGE_CONTAINER = "blink-net-test-bridge";

  try {
    // Start containers in parallel
    // Host network: bind to random port (0) since we share the host's network
    // Bridge network: bind to fixed port 3000 so Docker port mapping works
    await Promise.all([
      dockerRun(HOST_CONTAINER, ["--network", "host"], CONTAINER_SERVER_SCRIPT),
      dockerRun(
        BRIDGE_CONTAINER,
        ["-e", "LISTEN_PORT=3000", "-p", "0:3000"],
        CONTAINER_SERVER_SCRIPT
      ),
    ]);

    // Wait for both servers to be ready by checking their logs
    // This ensures the server is actually listening before we test connections
    const [hostNetPort, bridgeServerReady] = await Promise.all([
      getPortFromLogs(HOST_CONTAINER),
      getPortFromLogs(BRIDGE_CONTAINER), // Wait for server to log its port (confirms it's listening)
    ]);

    // For bridge container, get the mapped host port (server listens on 3000 inside)
    const bridgePort = bridgeServerReady
      ? await getPortFromDockerPort(BRIDGE_CONTAINER, 3000)
      : null;

    const hostNetReady = hostNetPort !== null;
    const bridgeReady = bridgePort !== null;

    // Test host → container
    if (hostNetReady) {
      results.hostNetwork.hostToContainer = await testConnection(
        `http://localhost:${hostNetPort}`
      );
    }
    if (bridgeReady) {
      results.portBind.hostToContainer = await testConnection(
        `http://localhost:${bridgePort}`
      );
    }

    // Test container → host
    const hostNetResult = await testContainerToHost(
      HOST_CONTAINER,
      hostPort,
      true
    );
    results.hostNetwork.containerToHost = hostNetResult.success;
    results.hostNetwork.hostAddress = hostNetResult.address;

    const bridgeResult = await testContainerToHost(
      BRIDGE_CONTAINER,
      hostPort,
      false
    );
    results.portBind.containerToHost = bridgeResult.success;
    results.portBind.hostAddress = bridgeResult.address;

    // Determine recommendation
    const hostWorks =
      results.hostNetwork.hostToContainer &&
      results.hostNetwork.containerToHost;
    const bridgeWorks =
      results.portBind.hostToContainer && results.portBind.containerToHost;

    if (hostWorks && bridgeWorks) results.recommended = "both";
    else if (hostWorks) results.recommended = "host";
    else if (bridgeWorks) results.recommended = "port-bind";
    else results.recommended = "none";
  } finally {
    // Cleanup
    hostServer.close();
    await Promise.all([dockerRm(HOST_CONTAINER), dockerRm(BRIDGE_CONTAINER)]);
  }

  return results;
}
