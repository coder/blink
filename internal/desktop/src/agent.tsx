import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useDevMode, Logger } from "blink/react";
import { setEsbuildInstance } from "blink/build";
import { MessageBubble } from "./components/MessageBubble";
import SourceBrowser, {
  buildFileTree,
  type TreeNode,
} from "./components/SourceBrowser";
import { Button } from "./components/ui/button";
import { Copy } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";

// Declare electron API
declare const require: any;

// Get directory from command line args
function getAgentDirectory(): string {
  const args = process.argv;
  for (const arg of args) {
    if (arg.startsWith("--agent-directory=")) {
      return arg.replace("--agent-directory=", "");
    }
  }
  return process.cwd();
}

// Setup module resolution to find dependencies
const agentDirectory = getAgentDirectory();
const path = require("path");
const fs = require("fs");

// Change working directory so file paths resolve correctly
process.chdir(agentDirectory);

// Try to load esbuild from the agent directory's node_modules
const searchPaths = [agentDirectory];
let currentDir = agentDirectory;
while (currentDir !== path.dirname(currentDir)) {
  currentDir = path.dirname(currentDir);
  searchPaths.push(currentDir);
}

let esbuildLoaded = false;
for (const searchPath of searchPaths) {
  const esbuildPath = path.join(searchPath, "node_modules", "esbuild");
  if (fs.existsSync(esbuildPath)) {
    try {
      const esbuild = require(esbuildPath);
      setEsbuildInstance(esbuild);
      esbuildLoaded = true;
      break;
    } catch (e) {
      // Try next path
    }
  }
}

if (!esbuildLoaded) {
  console.warn(
    "Could not find esbuild in agent directory or parent directories"
  );
}

function AgentWindow() {
  const directory = agentDirectory;
  const [logs, setLogs] = useState<string[]>([]);
  const [input, setInput] = useState<string>("");
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const hasScrolledOnceRef = React.useRef(false);

  const projectName = useMemo(
    () => directory.split("/").pop() || directory,
    [directory]
  );

  const appendLog = useCallback((entry: string) => {
    setLogs((prev) => [...prev, entry]);
  }, []);

  const handleBuildStart = useCallback(() => {
    appendLog("🔨 Build started...");
  }, [appendLog]);

  const handleBuildSuccess = useCallback(
    (result: { duration: number }) => {
      appendLog(`✅ Build succeeded in ${result.duration}ms`);
    },
    [appendLog]
  );

  const handleBuildError = useCallback(
    (error: { message: string }) => {
      appendLog(`❌ Build error: ${error.message}`);
    },
    [appendLog]
  );

  const handleEnvLoaded = useCallback(
    (keys: string[]) => {
      appendLog(`🔑 Environment loaded (${keys.length} variables)`);
    },
    [appendLog]
  );

  const handleDevhookConnected = useCallback(
    (url: string) => {
      appendLog(`🌐 Devhook connected: ${url}`);
    },
    [appendLog]
  );

  const handleAgentLog = useCallback(
    (log: { message: string }) => {
      appendLog(`📝 ${log.message}`);
    },
    [appendLog]
  );

  const handleError = useCallback(
    (error: unknown) => {
      const errorMessage = String(error);
      appendLog(`⚠️  ${errorMessage}`);
      // Set chat error for banner display
      setChatError(errorMessage);
    },
    [appendLog]
  );

  const handleModeChange = useCallback(
    (mode: string) => {
      appendLog(`🔄 Mode changed to: ${mode}`);
    },
    [appendLog]
  );

  const devModeConfig = useMemo(
    () => ({
      directory,
      onBuildStart: handleBuildStart,
      onBuildSuccess: handleBuildSuccess,
      onBuildError: handleBuildError,
      onEnvLoaded: handleEnvLoaded,
      onDevhookConnected: handleDevhookConnected,
      onAgentLog: handleAgentLog,
      onError: handleError,
      onModeChange: handleModeChange,
      logger: new Logger(async (level, source, ...message) => {
        console[level](source, ...message);
      }),
    }),
    [
      directory,
      handleBuildStart,
      handleBuildSuccess,
      handleBuildError,
      handleEnvLoaded,
      handleDevhookConnected,
      handleAgentLog,
      handleError,
      handleModeChange,
    ]
  );

  const devMode = useDevMode(devModeConfig);

  // Auto-scroll to bottom when messages change
  React.useEffect(() => {
    // Use instant scroll on first load, smooth scroll after that
    const behavior = hasScrolledOnceRef.current ? "smooth" : "auto";
    messagesEndRef.current?.scrollIntoView({ behavior });
    hasScrolledOnceRef.current = true;
  }, [devMode.chat.messages, devMode.chat.streamingMessage]);

  // Update window title
  React.useEffect(() => {
    const dirName = directory.split("/").pop() || directory;
    const modeIndicator = devMode.mode === "edit" ? "✎" : "▶";
    document.title = `${modeIndicator} ${dirName} - Blink Desktop`;
  }, [directory, devMode.mode]);

  const handleSubmit = async () => {
    if (!input.trim()) return;

    const message = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      role: "user" as const,
      parts: [{ type: "text" as const, text: input }],
      metadata: undefined,
      mode: devMode.mode,
    };

    setInput("");
    // Clear any existing error when sending a new message
    setChatError(null);
    await devMode.chat.sendMessage(message);
  };

  const colors = {
    run: "#3b82f6",
    edit: "#f59e0b",
  };

  // Keybindings (same as TUI)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+T - Toggle mode
      if (e.ctrlKey && e.key === "t") {
        e.preventDefault();
        devMode.toggleMode();
      }
      // Ctrl+N - New chat
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        devMode.newChat();
      }
      // Ctrl+R - Reset chat
      if (e.ctrlKey && e.key === "r") {
        e.preventDefault();
        devMode.chat.resetChat();
      }
      // Escape - Stop streaming
      if (e.key === "Escape") {
        e.preventDefault();
        devMode.chat.stopStreaming();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [devMode]);

  // Source browser state
  const [showSourceBrowser, setShowSourceBrowser] = useState(true);
  const [sourceFiles, setSourceFiles] = useState<
    Array<{ name: string; path: string; content?: string }>
  >([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);

  // Load source files from agent directory
  useEffect(() => {
    const loadSourceFiles = async () => {
      try {
        const fs = require("fs");
        const path = require("path");
        const files: Array<{ name: string; path: string }> = [];

        const walkDir = (dir: string, base: string = directory) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(base, fullPath);

            // Skip node_modules, .git
            if (
              relativePath.includes("node_modules") ||
              relativePath.includes(".git")
            ) {
              continue;
            }

            if (entry.isDirectory()) {
              walkDir(fullPath, base);
            } else if (entry.isFile()) {
              files.push({
                name: entry.name,
                path: relativePath,
              });
            }
          }
        };

        walkDir(directory);
        setSourceFiles(files);
        setFileTree(buildFileTree(files));
      } catch (err) {
        console.error("Failed to load source files:", err);
      }
    };

    if (showSourceBrowser) {
      loadSourceFiles();
    }
  }, [directory, showSourceBrowser]);

  // Load file content when selected
  const selectedFileContent = useMemo(() => {
    if (!selectedFile) return null;
    try {
      const fs = require("fs");
      const path = require("path");
      const fullPath = path.join(directory, selectedFile);
      return fs.readFileSync(fullPath, "utf-8");
    } catch (err) {
      console.error("Failed to load file:", err);
      return null;
    }
  }, [selectedFile, directory]);

  // Deploy handler
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);

  const handleDeploy = useCallback(async () => {
    setDeploying(true);
    setDeployStatus("Building...");
    try {
      // We'll call the deploy function from the CLI
      const { spawn } = require("child_process");
      const process = spawn("blink", ["deploy"], {
        cwd: directory,
        shell: true,
      });

      let output = "";
      process.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
        // Show last line of output
        const lines = output.trim().split("\n");
        setDeployStatus(lines[lines.length - 1] ?? null);
      });

      process.stderr?.on("data", (data: Buffer) => {
        output += data.toString();
        const lines = output.trim().split("\n");
        setDeployStatus(lines[lines.length - 1] ?? null);
      });

      process.on("close", (code: number) => {
        if (code === 0) {
          setDeployStatus("✅ Deployed successfully!");
        } else {
          setDeployStatus("❌ Deploy failed");
        }
        setTimeout(() => {
          setDeploying(false);
          setDeployStatus(null);
        }, 3000);
      });
    } catch (err) {
      setDeployStatus("❌ Deploy failed: " + (err as Error).message);
      setTimeout(() => {
        setDeploying(false);
        setDeployStatus(null);
      }, 3000);
    }
  }, [directory]);

  const handleCopyDirectory = useCallback(() => {
    try {
      const { clipboard } = require("electron");
      clipboard.writeText(directory);
    } catch (err) {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(directory).catch(() => {});
      }
    }
  }, [directory]);

  return (
    <div className="dark flex h-screen flex-col bg-background text-foreground">
      <header
        className="flex items-center justify-between border-b border-border bg-background px-5 py-3"
        style={{ WebkitAppRegion: "drag" } as any}
      >
        <div
          className="flex items-center gap-3 pl-16"
          style={{ WebkitAppRegion: "drag" } as any}
        >
          <svg
            viewBox="0 0 138 32"
            fill="white"
            xmlns="http://www.w3.org/2000/svg"
            style={{ height: "22px", marginRight: "12px" }}
          >
            <rect x="112" width="26" height="32" fill="white" />
            <path
              d="M13.4413 32C11.812 32 10.3864 31.6512 9.1645 30.9537C7.97166 30.2561 7.04066 29.2825 6.37151 28.0327L6.24058 31.4768H0V0.523162H6.54607V11.4223C7.15703 10.347 8.05894 9.44596 9.25178 8.71935C10.4446 7.96367 11.8411 7.58583 13.4413 7.58583C15.4196 7.58583 17.1362 8.09446 18.5908 9.11172C20.0455 10.0999 21.1656 11.5095 21.9511 13.3406C22.7658 15.1717 23.1731 17.3224 23.1731 19.7929C23.1731 22.2634 22.7658 24.4142 21.9511 26.2452C21.1656 28.0763 20.0455 29.5005 18.5908 30.5177C17.1362 31.5059 15.4196 32 13.4413 32ZM11.6084 26.9864C13.063 26.9864 14.2268 26.3615 15.0996 25.1117C16.0015 23.8329 16.4525 22.0599 16.4525 19.7929C16.4525 17.5259 16.016 15.7675 15.1432 14.5177C14.2704 13.2389 13.1067 12.5995 11.652 12.5995C10.5755 12.5995 9.64454 12.8901 8.85901 13.4714C8.10258 14.0236 7.52071 14.8374 7.11339 15.9128C6.73518 16.9882 6.54607 18.2816 6.54607 19.7929C6.54607 21.2752 6.73518 22.554 7.11339 23.6294C7.52071 24.7048 8.10258 25.5332 8.85901 26.1144C9.64454 26.6957 10.561 26.9864 11.6084 26.9864Z"
              fill="white"
            />
            <path
              d="M33.5554 31.4768C31.6352 31.4768 30.1369 30.9973 29.0605 30.0381C27.984 29.079 27.4458 27.5241 27.4458 25.3733V0.523162H33.9918V24.6757C33.9918 25.3733 34.1518 25.8674 34.4719 26.158C34.7919 26.4487 35.2574 26.594 35.8684 26.594H37.4394V31.4768H33.5554Z"
              fill="white"
            />
            <path
              d="M40.7851 31.4768V8.10899H47.3311V31.4768H40.7851ZM40.6541 5.23161V0H47.4184V5.23161H40.6541Z"
              fill="white"
            />
            <path
              d="M53.3573 31.4768V8.10899H59.2487L59.5106 14.9537L58.6814 14.7357C58.9142 12.9918 59.3797 11.5967 60.0779 10.5504C60.8052 9.50409 61.7071 8.74841 62.7836 8.28338C63.8601 7.81835 65.0384 7.58583 66.3185 7.58583C68.0059 7.58583 69.4315 7.94914 70.5953 8.67575C71.7881 9.40236 72.69 10.4342 73.301 11.7711C73.941 13.079 74.261 14.634 74.261 16.436V31.4768H67.715V18.6158C67.715 17.366 67.6132 16.3052 67.4095 15.4332C67.2058 14.5613 66.8422 13.9074 66.3185 13.4714C65.7948 13.0064 65.0675 12.7738 64.1365 12.7738C62.7691 12.7738 61.7217 13.2825 60.9944 14.2997C60.267 15.2879 59.9033 16.7266 59.9033 18.6158V31.4768H53.3573Z"
              fill="white"
            />
            <path
              d="M79.6523 31.4768V0.523162H86.1984V17.7003L94.8829 8.10899H102.738L93.6609 17.7439L103 31.4768H95.843L89.4278 21.4496L86.1984 24.8937V31.4768H79.6523Z"
              fill="white"
            />
          </svg>
          <span className="text-sm font-normal text-muted-foreground">
            {directory.split("/").pop()}
          </span>
        </div>
        <div
          className="flex items-center gap-3"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <Button
            className="gap-2"
            style={{
              backgroundColor:
                devMode.mode === "edit" ? colors.edit : colors.run,
            }}
            onClick={devMode.toggleMode}
            title="Toggle mode (Ctrl+T)"
          >
            {devMode.mode === "edit" ? "✎" : "▶"} {devMode.mode}
          </Button>
          {devMode.devhook.connected && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              ● connected
            </span>
          )}
        </div>
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: "no-drag" } as any}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSourceBrowser(!showSourceBrowser)}
            title="Toggle source browser"
          >
            {showSourceBrowser ? "📁 Hide Source" : "📁 Show Source"}
          </Button>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={handleDeploy}
            disabled={deploying}
            title="Deploy to production"
          >
            {deploying ? "⏳" : "🚀"} Deploy
          </Button>
        </div>
      </header>

      {deployStatus && (
        <div className="border-b border-border bg-card px-5 py-3 font-mono text-sm text-card-foreground">
          {deployStatus}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Chats + Info */}
        <div className="flex w-60 min-w-60 flex-col border-r border-border bg-background overflow-y-auto">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Chats
            </h3>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={devMode.newChat}
              title="New Chat (Ctrl+N)"
            >
              +
            </Button>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {devMode.chats.map((chatId) => (
              <div
                key={chatId}
                className={`cursor-pointer border-b border-card p-3 transition-colors hover:bg-accent ${
                  devMode.chat.id === chatId ? "bg-accent" : ""
                }`}
                onClick={() => devMode.switchChat(chatId)}
              >
                <div className="mb-1 text-sm font-medium text-card-foreground">
                  {chatId.slice(0, 8)}
                </div>
                {chatId === devMode.chat.id && (
                  <div className="text-xs text-muted-foreground">
                    {devMode.chat.messages.length} messages
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Info & Activity Section */}
          <div className="border-b border-border p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Info
            </h3>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between rounded-md border border-border bg-card p-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Build
                </span>
                <span
                  className={`text-sm font-semibold ${
                    devMode.build.status === "success"
                      ? "text-green-500"
                      : devMode.build.status === "error"
                        ? "text-red-500"
                        : "text-muted-foreground"
                  }`}
                >
                  {devMode.build.status === "success"
                    ? "✓"
                    : devMode.build.status === "error"
                      ? "✗"
                      : "○"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border bg-card p-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Messages
                </span>
                <span className="text-sm font-semibold text-card-foreground">
                  {devMode.chat.messages.length}
                </span>
              </div>
            </div>
          </div>

          <div className="border-b border-border p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Directory
            </h3>
            <div
              className="mb-2 overflow-hidden text-ellipsis rounded-md border border-border bg-card p-2 font-mono text-xs text-muted-foreground"
              title={directory}
            >
              {directory.split("/").pop()}
            </div>
            {devMode.build.entrypoint && (
              <div
                className="mb-2 overflow-hidden text-ellipsis rounded-md border border-border bg-card p-2 font-mono text-xs text-muted-foreground"
                title={devMode.build.entrypoint}
              >
                {devMode.build.entrypoint}
              </div>
            )}
            {devMode.devhook.url && (
              <div
                className="mb-2 overflow-hidden text-ellipsis rounded-md border border-border bg-card p-2 font-mono text-xs text-muted-foreground"
                title={devMode.devhook.url}
              >
                {new URL(devMode.devhook.url).host}
              </div>
            )}
          </div>

          <div className="border-b border-border p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Activity
            </h3>
            <div className="font-mono text-xs text-muted-foreground">
              {logs.slice(-5).map((log, i) => (
                <div key={i} className="border-b border-card py-1">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main chat area */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-border bg-background px-5 py-3">
            <div className="flex flex-col gap-1">
              <span
                className="truncate text-sm font-semibold text-foreground"
                title={projectName}
              >
                {projectName}
              </span>
              <div className="min-w-0 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate font-mono" title={directory}>
                  {directory}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={handleCopyDirectory}
                  aria-label="Copy project path"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 relative">
            {/* Chat Error Toast Overlay */}
            {chatError && (
              <div
                className="absolute top-5 left-5 right-5 z-50"
                style={{
                  animation: "fadeInDown 0.3s ease-out",
                }}
              >
                <div
                  className="rounded-lg px-4 py-3 shadow-lg"
                  style={{
                    backgroundColor: "rgba(127, 29, 29, 0.7)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border: "1px solid rgb(248, 113, 113)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-medium text-sm mb-1"
                        style={{
                          color: "rgb(252, 165, 165)",
                        }}
                      >
                        Chat Error
                      </div>
                      <div
                        className="font-mono text-xs whitespace-pre-wrap break-words"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          color: "rgb(254, 202, 202)",
                        }}
                      >
                        {chatError}
                      </div>
                    </div>
                    <button
                      onClick={() => setChatError(null)}
                      className="transition-colors flex-shrink-0 mt-0.5"
                      style={{
                        color: "rgb(252, 165, 165)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "rgb(254, 202, 202)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "rgb(252, 165, 165)";
                      }}
                      aria-label="Dismiss error"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto py-5">
              {devMode.chat.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  streaming={false}
                  onApprove={devMode.approval?.approve}
                  onReject={devMode.approval?.reject}
                  autoApproveEnabled={devMode.approval?.autoApproveEnabled}
                />
              ))}
              {devMode.chat.streamingMessage && (
                <MessageBubble
                  message={devMode.chat.streamingMessage as any}
                  streaming={true}
                  onApprove={devMode.approval?.approve}
                  onReject={devMode.approval?.reject}
                  autoApproveEnabled={devMode.approval?.autoApproveEnabled}
                />
              )}
              {devMode.showWaitingPlaceholder && (
                <div className="mb-6 flex items-center gap-2 px-1 py-1">
                  <div className="flex items-center gap-1">
                    <div
                      className="text-muted-foreground"
                      style={{
                        animation: "bounce 1.4s infinite",
                        animationDelay: "0s",
                        fontSize: "8px",
                      }}
                    >
                      ●
                    </div>
                    <div
                      className="text-muted-foreground"
                      style={{
                        animation: "bounce 1.4s infinite",
                        animationDelay: "0.2s",
                        fontSize: "8px",
                      }}
                    >
                      ●
                    </div>
                    <div
                      className="text-muted-foreground"
                      style={{
                        animation: "bounce 1.4s infinite",
                        animationDelay: "0.4s",
                        fontSize: "8px",
                      }}
                    >
                      ●
                    </div>
                  </div>
                </div>
              )}
              {devMode.chat.messages.length === 0 &&
                !devMode.chat.streamingMessage && (
                  <div className="flex h-full flex-col items-center justify-center p-10 text-center">
                    <div className="mb-2 text-base font-semibold text-muted-foreground">
                      Chat with your agent
                    </div>
                    <div className="text-sm text-muted-foreground/70">
                      Type a message below to get started
                    </div>
                  </div>
                )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="mb-3 mt-4 flex gap-2 px-5">
            <input
              type="text"
              className="flex-1 rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2"
              placeholder="Type a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <Button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="bg-blue-600 px-7 shadow hover:bg-blue-700"
            >
              Send
            </Button>
          </div>

          {/* Footer with keybinds hint */}
          <div className="flex flex-wrap items-center gap-4 px-5 pb-5 text-[11px] text-muted-foreground/60">
            <span>Ctrl+T toggle mode</span>
            <span>Ctrl+N new chat</span>
            <span>Ctrl+R reset</span>
            <span>Esc stop</span>
          </div>

          {devMode.approval && (
            <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-blue-600 bg-card p-4 shadow-lg">
              <div className="flex flex-col gap-3">
                <p className="m-0 text-sm font-bold text-foreground">
                  ⚠️ Tool approval required
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => devMode.approval?.approve()}
                    autoFocus
                  >
                    Approve
                  </Button>
                  <Button
                    variant="default"
                    className="bg-red-600 hover:bg-red-700"
                    onClick={() => devMode.approval?.reject()}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Source Browser */}
        {showSourceBrowser && (
          <SourceBrowser
            fileTree={fileTree}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            fileContent={selectedFileContent}
            directory={directory}
            blinkVersion={null}
          />
        )}
      </div>
    </div>
  );
}

// Initialize the React app
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<AgentWindow />);
}
