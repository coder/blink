import React, { useState, useEffect, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { useAuth } from "./hooks/useAuth";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Button } from "./components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/ui/card";
import { Alert, AlertDescription } from "./components/ui/alert";

const AgentView = React.lazy(() => import("./components/AgentView"));

// Declare electron API available via nodeIntegration
declare const require: any;
const { dialog } = require("electron").remote || require("@electron/remote");
const { ipcRenderer } = require("electron");

// Get directory from command line args if provided
function getAgentDirectory(): string | null {
  const args = process.argv;
  for (const arg of args) {
    if (arg.startsWith("--agent-directory=")) {
      return arg.replace("--agent-directory=", "");
    }
  }
  return null;
}

function App() {
  const [error, setError] = useState<string | null>(null);
  const [agentDirectory, setAgentDirectory] = useState<string | null>(
    getAgentDirectory()
  );
  const auth = useAuth();

  const [creating, setCreating] = useState(false);
  const [switchAgentError, setSwitchAgentError] = useState<string | null>(null);

  const isLoading = auth.status === "initializing";

  const createNewAgent = async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "Create New Agent",
        buttonLabel: "Create Here",
        message: "Choose or create a folder to initialize a new Blink agent",
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const targetDir = result.filePaths[0];

        // Check if directory is empty
        const fs = require("fs");
        const files = fs.readdirSync(targetDir);
        // Filter out hidden files like .DS_Store
        const visibleFiles = files.filter(
          (file: string) => !file.startsWith(".")
        );

        if (visibleFiles.length > 0) {
          setError("Please select an empty folder to create a new agent.");
          return;
        }

        setCreating(true);
        setError(null);

        const { spawn } = require("child_process");
        const proc = spawn(
          process.platform === "win32" ? "cmd" : "bash",
          [
            process.platform === "win32" ? "/c" : "-lc",
            // Try blink first, then fall back to npx/pnpx
            "blink init || pnpx blink init || npx blink init",
          ],
          {
            cwd: targetDir,
            shell: false,
          }
        );

        let output = "";
        proc.stdout?.on("data", (data: Buffer) => {
          output += data.toString();
        });
        proc.stderr?.on("data", (data: Buffer) => {
          output += data.toString();
        });
        proc.on("close", (code: number) => {
          setCreating(false);
          if (code === 0) {
            setAgentDirectory(targetDir);
          } else {
            const tail = output.trim().split("\n").slice(-3).join("\n");
            const details = tail ? `\n${tail}` : "";
            setError(
              `Failed to initialize agent. Is the Blink CLI installed? Try: npm i -g @blink.so/cli or use pnpx blink init.${details}`
            );
          }
        });
      }
    } catch (err) {
      setCreating(false);
      setError(`Failed to create agent: ${err}`);
    }
  };

  const selectDirectory = async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Open Agent Folder",
        buttonLabel: "Open",
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedDir = result.filePaths[0];

        // Check if directory contains a Blink agent
        const fs = require("fs");
        const path = require("path");

        // Look for agent.ts as the indicator of a Blink agent
        const agentTs = path.join(selectedDir, "agent.ts");

        if (!fs.existsSync(agentTs)) {
          setError(
            "Please select a folder that already contains a Blink agent."
          );
          return;
        }

        setAgentDirectory(selectedDir);
        setError(null);
      }
    } catch (err) {
      setError(`Failed to select directory: ${err}`);
    }
  };

  // Handler for switching agent directories
  const handleSwitchAgent = (newDirectory: string) => {
    // Check if directory contains a Blink agent
    const fs = require("fs");
    const path = require("path");

    // Look for agent.ts as the indicator of a Blink agent
    const agentTs = path.join(newDirectory, "agent.ts");

    if (!fs.existsSync(agentTs)) {
      // Show error dialog since we're already in AgentView
      setSwitchAgentError(
        "Please select a folder that already contains a Blink agent."
      );
      return;
    }

    setAgentDirectory(newDirectory);
    setError(null);
  };

  // If we have an agent directory and are authenticated, show the agent view
  if (agentDirectory && auth.status === "authenticated") {
    return (
      <Suspense fallback={<div className="p-6 text-sm">Loading editor…</div>}>
        <AgentView
          directory={agentDirectory}
          onSwitchAgent={handleSwitchAgent}
          switchAgentError={switchAgentError}
          onDismissSwitchAgentError={() => setSwitchAgentError(null)}
        />
      </Suspense>
    );
  }

  // Otherwise show the welcome/onboarding screen
  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ WebkitAppRegion: "drag" } as any}
    >
      {/* Left side - Login content (2/3) */}
      <div
        className="w-2/3 flex flex-col px-20 pt-16"
        style={{ backgroundColor: "#111111" }}
      >
        <div className="max-w-lg">
          {/* Logo */}
          <div className="mb-16">
            <h1
              className="tracking-tight text-white"
              style={{ fontSize: "50px", fontWeight: 600 }}
            >
              Blink Desktop
            </h1>
            <p className="text-lg text-gray-400">
              Two modes. One chat. Continuous iteration.
            </p>
          </div>

          {/* Auth Content */}
          <div
            style={{ marginTop: "180px", WebkitAppRegion: "no-drag" } as any}
          >
            {isLoading ? (
              <div className="flex flex-col items-start gap-6 py-8">
                <div className="h-10 w-10 animate-spin rounded-full border-3 border-gray-700 border-t-white" />
                <p className="text-base text-gray-300">
                  Checking authentication...
                </p>
              </div>
            ) : auth.status !== "authenticated" ? (
              <div className="space-y-8">
                {auth.status === "idle" && (
                  <>
                    <div className="space-y-2 mb-10">
                      <h2 className="text-3xl font-semibold text-white">
                        Get started
                      </h2>
                      <p className="text-base text-gray-400">
                        Sign in to start building with Blink
                      </p>
                    </div>
                    <div className="space-y-4">
                      <Button
                        onClick={auth.login}
                        size="lg"
                        className="h-14 bg-white text-black hover:bg-gray-300 font-medium rounded-xl transition-all duration-150 shadow-sm hover:shadow-xl hover:scale-[1.02] px-16"
                      >
                        Authenticate with Blink
                      </Button>
                      <p className="text-xs text-gray-500 text-left mt-4">
                        Authenticate with Blink via your browser to start
                        chatting using Blink's LLM gateway.
                      </p>
                    </div>
                  </>
                )}

                {auth.status === "authenticating" && (
                  <div className="flex flex-col items-start gap-6 py-8">
                    <div className="h-10 w-10 animate-spin rounded-full border-3 border-gray-700 border-t-white" />
                    <p className="text-base text-gray-300">
                      {auth.authUrl
                        ? "Waiting for authentication..."
                        : "Opening browser..."}
                    </p>
                  </div>
                )}

                {auth.status === "error" && (
                  <div className="space-y-6">
                    <div className="rounded-xl bg-red-950 border border-red-800 p-5">
                      <p className="text-sm text-red-200">
                        {auth.error || "Authentication failed"}
                      </p>
                    </div>
                    <Button
                      onClick={auth.login}
                      size="lg"
                      className="w-full h-14 bg-white text-black hover:bg-gray-100 font-medium rounded-xl transition-all duration-200 shadow-sm"
                    >
                      Try Again
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-8">
                <div
                  className="space-y-2 mb-10"
                  style={{
                    animation: "fadeInUp 0.8s ease-out forwards",
                    opacity: 0,
                  }}
                >
                  <h2 className="text-3xl font-semibold text-white">
                    Welcome back
                  </h2>
                  <p className="text-base text-gray-400">
                    Create a new agent or open an existing one
                  </p>
                </div>
                <div
                  className="flex gap-3"
                  style={{
                    animation: "fadeInUp 0.8s ease-out forwards",
                    animationDelay: "0.3s",
                    opacity: 0,
                  }}
                >
                  <Button
                    onClick={createNewAgent}
                    size="lg"
                    className="h-14 bg-white text-black hover:bg-gray-300 font-medium rounded-xl transition-all duration-150 shadow-sm hover:shadow-xl hover:scale-[1.02]"
                    style={{ width: "240px" }}
                    disabled={creating}
                  >
                    {creating ? "Creating Agent..." : "Create New Agent"}
                  </Button>
                  <Button
                    onClick={selectDirectory}
                    size="lg"
                    className="h-14 text-white hover:bg-gray-700 font-medium rounded-xl border border-gray-600 transition-all duration-150 hover:border-gray-400 hover:scale-[1.02]"
                    style={{ width: "240px", backgroundColor: "transparent" }}
                    disabled={creating}
                  >
                    Select Existing Agent
                  </Button>
                </div>
                {error && (
                  <Alert variant="destructive" className="mt-6">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right side - Subtle Gradient (1/3) */}
      <div
        className="w-1/3 relative"
        style={{
          background:
            "radial-gradient(circle 800px at top left, #1a1a1a, #111111)",
        }}
      />
    </div>
  );
}

// Initialize the React app
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}
