import { spawn } from "node:child_process";
import http from "node:http";
import { createServer } from "node:net";

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

async function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" ? addr?.port : 0;
      server.close(() => resolve(port!));
    });
    server.on("error", reject);
  });
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
  await execDocker([
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
}

async function dockerRm(name: string): Promise<void> {
  await execDocker(["rm", "-f", name]);
}

const CONTAINER_SERVER_SCRIPT = `
const http = require("http");
const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ source: "container" }));
}).listen(port, "0.0.0.0", () => console.log("ready"));
`;

async function testConnection(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(
  url: string,
  maxAttempts = 10,
  delayMs = 300
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await testConnection(url)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
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
      // Continue to next address
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

  // Get random ports for containers
  const hostNetPort = await getRandomPort();
  const bridgePort = await getRandomPort();

  const HOST_CONTAINER = "blink-net-test-host";
  const BRIDGE_CONTAINER = "blink-net-test-bridge";

  try {
    // Start containers in parallel
    await Promise.all([
      dockerRun(
        HOST_CONTAINER,
        ["--network", "host"],
        CONTAINER_SERVER_SCRIPT.replace("3000", String(hostNetPort))
      ),
      dockerRun(
        BRIDGE_CONTAINER,
        ["-p", `${bridgePort}:3000`],
        CONTAINER_SERVER_SCRIPT
      ),
    ]);

    // Wait for containers to be ready
    const [hostNetReady, bridgeReady] = await Promise.all([
      waitForServer(`http://localhost:${hostNetPort}`),
      waitForServer(`http://localhost:${bridgePort}`),
    ]);

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
