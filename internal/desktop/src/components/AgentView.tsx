import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useDevMode, Logger } from "blink/react";
import { setEsbuildInstance } from "blink/build";
import { isToolOrDynamicToolUIPart } from "ai";
import { useTheme } from "../contexts/ThemeContext";
import { MessageBubble } from "../components/MessageBubble";
import SourceBrowser, {
  buildFileTree,
  type TreeNode,
} from "../components/SourceBrowser";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Tooltip } from "../components/ui/tooltip";
import { Switch } from "../components/ui/switch";
import { Select } from "../components/ui/select";
import {
  SendHorizonal,
  Copy,
  Trash2,
  ArrowLeftRight,
  Plus,
  FolderTree,
  Settings,
  Eye,
  EyeOff,
  LogOut,
  User,
  ExternalLink,
  ArrowDown,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import type { ID } from "blink";

declare const require: any;

interface AgentViewProps {
  directory: string;
  onSwitchAgent?: (directory: string) => void;
  switchAgentError?: string | null;
  onDismissSwitchAgentError?: () => void;
}

export default function AgentView({
  directory,
  onSwitchAgent,
  switchAgentError,
  onDismissSwitchAgentError,
}: AgentViewProps) {
  const auth = useAuth();
  const path = require("path");
  const fs = require("fs");
  const { theme, setTheme } = useTheme();

  // Change working directory so file paths resolve correctly
  useEffect(() => {
    try {
      process.chdir(directory);
    } catch (e) {
      console.warn("Failed to chdir to directory", directory, e);
    }
  }, [directory]);

  // Try to load esbuild from the agent directory's node_modules
  useEffect(() => {
    const searchPaths = [directory];
    let currentDir = directory;
    while (currentDir !== path.dirname(currentDir)) {
      currentDir = path.dirname(currentDir);
      searchPaths.push(currentDir);
    }

    let loaded = false;
    for (const searchPath of searchPaths) {
      const esbuildPath = path.join(searchPath, "node_modules", "esbuild");
      if (fs.existsSync(esbuildPath)) {
        try {
          const esbuild = require(esbuildPath);
          setEsbuildInstance(esbuild);
          loaded = true;
          break;
        } catch (e) {
          // Try next path
        }
      }
    }

    if (!loaded) {
      console.warn(
        "Could not find esbuild in agent directory or parent directories"
      );
    }
  }, [directory]);

  const [logs, setLogs] = useState<string[]>([]);
  const [input, setInput] = useState<string>("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const messagesContainerRef = React.useRef<HTMLDivElement>(null);
  const isAtBottomRef = React.useRef(true);
  const isAutoScrollingRef = React.useRef(false);
  const lastMessageCountRef = React.useRef(0);
  const lastStreamingMessageRef = React.useRef<string>("");
  const lastToolCallContentRef = React.useRef<string>("");
  const hasScrolledOnceRef = React.useRef(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showButton, setShowButton] = useState(false);
  const showButtonRef = React.useRef(false);
  const [isExiting, setIsExiting] = useState(false);
  const isExitingRef = React.useRef(false);

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

  // Check if user is scrolled to bottom
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Skip if this is an auto-scroll
      if (isAutoScrollingRef.current) return;

      const threshold = 100; // pixels from bottom to be considered "at bottom"
      const scrollHeight = container.scrollHeight;
      const scrollTop = container.scrollTop;
      const clientHeight = container.clientHeight;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const nearBottom = distanceFromBottom < threshold;

      console.log("[SCROLL]", {
        nearBottom,
        showButton: showButtonRef.current,
        isExiting: isExitingRef.current,
      });

      isAtBottomRef.current = nearBottom;
      setIsNearBottom(nearBottom);

      if (!nearBottom && !showButtonRef.current && !isExitingRef.current) {
        console.log("[SCROLL] Showing button");
        showButtonRef.current = true;
        setShowButton(true);
        setIsExiting(false);
        isExitingRef.current = false;
      } else if (nearBottom && showButtonRef.current && !isExitingRef.current) {
        console.log("[SCROLL] Hiding button with animation");
        isExitingRef.current = true;
        setIsExiting(true);
        setTimeout(() => {
          console.log("[SCROLL] Animation complete, removing button");
          showButtonRef.current = false;
          setShowButton(false);
          setIsExiting(false);
          isExitingRef.current = false;
        }, 300);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Auto-scroll to bottom when messages change, but only if user is at bottom
  useEffect(() => {
    const messageCount = devMode.chat.messages.length;
    // Get text content from streaming message to detect actual changes
    const streamingContent =
      devMode.chat.streamingMessage?.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as any).text)
        .join("") || "";

    // Also track tool call content changes (input, output, state)
    const toolCallContent =
      devMode.chat.streamingMessage?.parts
        .filter(isToolOrDynamicToolUIPart)
        .map(
          (p: any) =>
            `${p.state}:${JSON.stringify(p.input)}:${JSON.stringify(p.output)}:${p.errorText || ""}`
        )
        .join("|") || "";

    // Only process if something actually changed
    if (
      messageCount === lastMessageCountRef.current &&
      streamingContent === lastStreamingMessageRef.current &&
      toolCallContent === lastToolCallContentRef.current
    ) {
      return;
    }

    lastMessageCountRef.current = messageCount;
    lastStreamingMessageRef.current = streamingContent;
    lastToolCallContentRef.current = toolCallContent;

    if (isAtBottomRef.current) {
      isAutoScrollingRef.current = true;
      // Use instant scroll on first load, smooth scroll after that
      const behavior = hasScrolledOnceRef.current ? "smooth" : "auto";
      messagesEndRef.current?.scrollIntoView({ behavior });
      hasScrolledOnceRef.current = true;
      // Reset flag after animation completes (smooth scroll typically takes ~300-500ms)
      setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, 1000);
    }
  }, [devMode.chat.messages, devMode.chat.streamingMessage]);

  // Update window title
  useEffect(() => {
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

  // Keybindings (same as TUI)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+T - Toggle mode
      if (e.ctrlKey && e.key === "t") {
        e.preventDefault();
        devMode.toggleMode();
        // Focus the input field after toggling
        setTimeout(() => {
          inputRef.current?.focus();
        }, 0);
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
  const [showSourceBrowser, setShowSourceBrowser] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<
    Array<{ name: string; path: string; content?: string }>
  >([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [fileTreeWidth, setFileTreeWidth] = useState(256);
  const [isResizingFileTree, setIsResizingFileTree] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<ID | null>(null);
  const [chatMetadata, setChatMetadata] = useState<
    Record<string, { lastMessage?: Date }>
  >({});
  const [deletedChats, setDeletedChats] = useState<Set<string>>(new Set());
  const [blinkVersion, setBlinkVersion] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "llm" | "account">(
    "general"
  );
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showMessageModeLabels, setShowMessageModeLabels] = useState(() => {
    const saved = localStorage.getItem("blink-show-message-mode-labels");
    return saved !== null ? saved === "true" : true; // Default to true
  });
  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">(() => {
    const saved = localStorage.getItem("blink-font-size");
    return saved === "small" || saved === "medium" || saved === "large"
      ? saved
      : "medium";
  });

  // Load saved API keys and settings on mount
  useEffect(() => {
    const savedOpenaiKey = localStorage.getItem("blink-openai-key");
    const savedAnthropicKey = localStorage.getItem("blink-anthropic-key");
    if (savedOpenaiKey) setOpenaiKey(savedOpenaiKey);
    if (savedAnthropicKey) setAnthropicKey(savedAnthropicKey);
  }, []);

  // Save settings function
  const handleSaveSettings = () => {
    // Save API keys to localStorage
    if (openaiKey) {
      localStorage.setItem("blink-openai-key", openaiKey);
    } else {
      localStorage.removeItem("blink-openai-key");
    }

    if (anthropicKey) {
      localStorage.setItem("blink-anthropic-key", anthropicKey);
    } else {
      localStorage.removeItem("blink-anthropic-key");
    }

    // Save message mode labels preference
    localStorage.setItem(
      "blink-show-message-mode-labels",
      showMessageModeLabels.toString()
    );

    // Save font size preference
    localStorage.setItem("blink-font-size", fontSize);

    // Note: Theme is already auto-saved by ThemeContext

    // Close the modal
    setShowSettings(false);
  };

  useEffect(() => {
    if (!isResizingSidebar) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.min(Math.max(event.clientX, 200), 500);
      setSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (!isResizingFileTree) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.min(
        Math.max(window.innerWidth - event.clientX, 200),
        500
      );
      setFileTreeWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingFileTree(false);
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
    };
  }, [isResizingFileTree]);

  // Load source files from agent directory
  useEffect(() => {
    const loadSourceFiles = async () => {
      try {
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
        setFileTree((prevTree) => buildFileTree(files, prevTree));
      } catch (err) {
        console.error("Failed to load source files:", err);
      }
    };

    if (!showSourceBrowser) {
      return;
    }

    loadSourceFiles();

    // Watch directory for file changes to auto-refresh file tree
    let watcher: any;
    let debounceTimer: NodeJS.Timeout | null = null;

    try {
      watcher = fs.watch(
        directory,
        { recursive: true },
        (eventType: string, filename: string) => {
          // Ignore changes in node_modules, .git, and .blink
          if (
            filename &&
            !filename.includes("node_modules") &&
            !filename.includes(".git") &&
            !filename.includes(".blink")
          ) {
            // Debounce the reload to avoid too many refreshes
            if (debounceTimer) {
              clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
              loadSourceFiles();
            }, 300);
          }
        }
      );
    } catch (err) {
      console.error("Failed to watch directory:", err);
    }

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (watcher) {
        watcher.close();
      }
    };
  }, [directory, showSourceBrowser]);

  // Get Blink version from agent's package.json
  useEffect(() => {
    const getVersion = async () => {
      try {
        const packageJsonPath = path.join(directory, "package.json");
        if (fs.existsSync(packageJsonPath)) {
          const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf-8")
          );
          // Check for blink in dependencies or devDependencies
          const blinkVersion =
            packageJson.dependencies?.["@blink.so/cli"] ||
            packageJson.devDependencies?.["@blink.so/cli"] ||
            packageJson.dependencies?.["blink"] ||
            packageJson.devDependencies?.["blink"];

          if (blinkVersion) {
            // Remove ^ or ~ prefix if present
            setBlinkVersion(blinkVersion.replace(/^[~^]/, ""));
          }
        }
      } catch (err) {
        console.error("Failed to get Blink version:", err);
      }
    };
    getVersion();
  }, [directory]);

  // Load file content when selected
  const selectedFileContent = useMemo(() => {
    if (!selectedFile) return null;
    try {
      const fullPath = path.join(directory, selectedFile);
      return fs.readFileSync(fullPath, "utf-8");
    } catch (err) {
      console.error("Failed to load file:", err);
      return null;
    }
  }, [selectedFile, directory]);

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

  const handleDeleteChat = useCallback(
    (chatId: ID) => {
      // If deleting the active chat, switch to it first then reset it
      if (chatId === devMode.chat.id) {
        // Reset (delete) the current chat
        devMode.chat.resetChat();
      } else {
        // Switch to the chat first, then reset it
        devMode.switchChat(chatId);
        // Use setTimeout to ensure the switch completes before resetting
        setTimeout(() => {
          devMode.chat.resetChat();
        }, 100);
      }

      // Mark chat as deleted in our local state
      setDeletedChats((prev) => new Set([...prev, chatId]));

      // Remove from persisted metadata
      setChatMetadata((prev) => {
        const newMetadata = { ...prev };
        delete newMetadata[chatId];
        return newMetadata;
      });

      setChatToDelete(null);
    },
    [devMode]
  );

  // Load persisted chat metadata from localStorage on startup
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`chat-metadata-${directory}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert stored timestamps back to Date objects
        const metadata: Record<string, { lastMessage?: Date }> = {};
        for (const [chatId, data] of Object.entries(parsed)) {
          if ((data as any).lastMessage) {
            metadata[chatId] = {
              lastMessage: new Date((data as any).lastMessage),
            };
          }
        }
        setChatMetadata(metadata);
      }
    } catch (err) {
      console.error("Failed to load chat metadata:", err);
    }
  }, [directory]);

  // Persist chat metadata to localStorage whenever it changes
  useEffect(() => {
    if (Object.keys(chatMetadata).length > 0) {
      try {
        // Convert Date objects to timestamps for storage
        const toStore: Record<string, { lastMessage?: string }> = {};
        for (const [chatId, data] of Object.entries(chatMetadata)) {
          if (data.lastMessage) {
            toStore[chatId] = {
              lastMessage: data.lastMessage.toISOString(),
            };
          }
        }
        localStorage.setItem(
          `chat-metadata-${directory}`,
          JSON.stringify(toStore)
        );
      } catch (err) {
        console.error("Failed to save chat metadata:", err);
      }
    }
  }, [chatMetadata, directory]);

  // Update chat metadata when messages change in current chat
  useEffect(() => {
    if (devMode.chat.messages.length > 0) {
      const lastMessage =
        devMode.chat.messages[devMode.chat.messages.length - 1];
      if (lastMessage) {
        setChatMetadata((prev) => ({
          ...prev,
          [devMode.chat.id]: {
            lastMessage: new Date(lastMessage.created_at),
          },
        }));
      }
    }
  }, [devMode.chat.messages, devMode.chat.id]);

  // Ensure current chat is always initialized in metadata
  useEffect(() => {
    if (devMode.chat.id && !chatMetadata[devMode.chat.id]) {
      setChatMetadata((prev) => ({
        ...prev,
        [devMode.chat.id]: {
          lastMessage: undefined,
        },
      }));
    }
  }, [devMode.chat.id, chatMetadata]);

  const formatChatTime = (date?: Date) => {
    if (!date) return "No messages";
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  const handleSwitchAgent = useCallback(async () => {
    try {
      const { dialog } =
        require("electron").remote || require("@electron/remote");
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Select Agent Folder",
        buttonLabel: "Open Agent",
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedDir = result.filePaths[0];
        // Call the parent's callback to switch agent
        if (onSwitchAgent) {
          onSwitchAgent(selectedDir);
        }
      }
    } catch (err) {
      console.error("Failed to select agent directory:", err);
    }
  }, [onSwitchAgent]);

  const handleToggleDirectory = useCallback((path: string) => {
    setFileTree((prevTree) => {
      const toggleNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((node) => {
          if (node.type === "directory") {
            if (node.path === path) {
              return { ...node, expanded: !node.expanded };
            }
            return { ...node, children: toggleNode(node.children) };
          }
          return node;
        });
      };
      return toggleNode(prevTree);
    });
  }, []);

  return (
    <div
      className={`${theme} flex h-screen flex-col bg-background text-foreground`}
    >
      <div className="relative flex flex-1 overflow-hidden">
        <div
          className="relative flex flex-col border-r border-border bg-card"
          style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        >
          <div className="p-4 pt-6">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-semibold text-foreground">
                Blink Desktop
              </h1>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setShowSettings(true)}
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
            {devMode.devhook.connected && (
              <span className="mt-2 inline-flex items-center gap-1 rounded bg-green-500/10 px-2 py-1 text-[11px] font-medium text-green-400">
                ● connected
              </span>
            )}
          </div>
          <div className="px-3 py-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-sm font-medium"
              onClick={devMode.newChat}
              title="New Chat (Ctrl+N)"
            >
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {(() => {
              // Ensure current chat is always included in the list
              const allChats = new Set([...devMode.chats]);
              if (devMode.chat.id) {
                allChats.add(devMode.chat.id);
              }

              const filteredChats = Array.from(allChats)
                .filter((chatId) => !deletedChats.has(chatId))
                .sort((a, b) => {
                  const aTime = chatMetadata[a]?.lastMessage?.getTime() || 0;
                  const bTime = chatMetadata[b]?.lastMessage?.getTime() || 0;
                  return bTime - aTime; // Most recent first
                });

              const canDeleteChats = filteredChats.length > 1;

              return filteredChats.map((chatId) => (
                <div
                  key={chatId}
                  className={`group cursor-pointer p-3 rounded-lg border transition-all hover:bg-accent hover:border-accent ${devMode.chat.id === chatId ? "bg-accent border-accent" : "bg-card border-border"}`}
                  onClick={() => devMode.switchChat(chatId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-card-foreground truncate">
                        {chatId.slice(0, 8)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatChatTime(chatMetadata[chatId]?.lastMessage)}
                      </div>
                    </div>
                    {canDeleteChats && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-6 w-6 transition-opacity text-muted-foreground hover:text-red-400 ${
                          devMode.chat.id === chatId
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setChatToDelete(chatId);
                        }}
                        title="Delete chat"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ));
            })()}
          </div>

          <div className="p-3 mt-auto">
            <div className="pb-1 pt-1">
              <Button
                variant="outline"
                className="w-full flex items-center justify-center gap-2"
                onClick={handleSwitchAgent}
              >
                <ArrowLeftRight className="h-4 w-4" />
                Switch Agent
              </Button>
            </div>
          </div>

          <div
            className={`absolute right-0 top-0 h-full w-1 cursor-col-resize ${
              isResizingSidebar ? "bg-border" : "bg-transparent"
            }`}
            onMouseDown={(event) => {
              event.preventDefault();
              setIsResizingSidebar(true);
            }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-border bg-background px-5 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="truncate text-base font-semibold text-foreground"
                    title={projectName}
                  >
                    {projectName}
                  </span>
                  {devMode.devhook.connected && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400 flex-shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400"></span>
                      Running Locally
                    </span>
                  )}
                  {devMode.build.status === "success" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400 flex-shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-400"></span>
                      Running Locally
                    </span>
                  )}
                  {devMode.build.status === "error" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400 flex-shrink-0">
                      ✗ Build Error
                    </span>
                  )}
                  {devMode.build.status === "building" && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400 flex-shrink-0">
                      🔨 Building
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
                  <span className="truncate font-mono" title={directory}>
                    {directory}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground flex-shrink-0"
                    onClick={() => {
                      const { shell } = require("electron");
                      shell.showItemInFolder(directory);
                    }}
                    aria-label="Open in Finder"
                    style={{ position: "relative", left: "-4px", top: "-1px" }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Tooltip
                  content={
                    showSourceBrowser ? "Hide file tree" : "Show file tree"
                  }
                  position="below"
                >
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowSourceBrowser(!showSourceBrowser)}
                  >
                    <FolderTree className="h-4 w-4" />
                  </Button>
                </Tooltip>
                {/* Temporarily hidden - Deploy button */}
                {false && (
                  <Tooltip content="Coming soon" position="below">
                    <Button variant="outline" className="opacity-50" disabled>
                      Deploy
                    </Button>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 relative">
            {/* Chat Error Toast Overlay */}
            {chatError && (
              <div
                className="absolute z-50"
                style={{
                  top: "20px",
                  left: "20px",
                  right: "20px",
                  animation: "fadeInDown 0.3s ease-out",
                }}
              >
                <div
                  className="rounded-lg px-4 py-3 shadow-lg"
                  style={{
                    backgroundColor:
                      theme === "dark"
                        ? "rgba(127, 29, 29, 0.7)"
                        : "rgba(220, 38, 38, 0.95)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border:
                      theme === "dark"
                        ? "1px solid rgb(248, 113, 113)"
                        : "1px solid rgb(185, 28, 28)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div
                        className="font-medium text-sm mb-1"
                        style={{
                          color:
                            theme === "dark"
                              ? "rgb(252, 165, 165)"
                              : "rgb(254, 242, 242)",
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
                          color:
                            theme === "dark"
                              ? "rgb(254, 202, 202)"
                              : "rgb(254, 242, 242)",
                        }}
                      >
                        {chatError}
                      </div>
                    </div>
                    <button
                      onClick={() => setChatError(null)}
                      className="transition-colors flex-shrink-0 mt-0.5"
                      style={{
                        color:
                          theme === "dark"
                            ? "rgb(252, 165, 165)"
                            : "rgb(254, 242, 242)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color =
                          theme === "dark"
                            ? "rgb(254, 202, 202)"
                            : "rgb(255, 255, 255)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color =
                          theme === "dark"
                            ? "rgb(252, 165, 165)"
                            : "rgb(254, 242, 242)";
                      }}
                      aria-label="Dismiss error"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto py-5"
            >
              {devMode.chat.messages.map((msg, index) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  streaming={false}
                  showModeLabel={showMessageModeLabels}
                  fontSize={fontSize}
                  onApprove={devMode.approval?.approve}
                  onReject={devMode.approval?.reject}
                  autoApproveEnabled={devMode.approval?.autoApproveEnabled}
                  previousMessage={
                    index > 0 ? devMode.chat.messages[index - 1] : undefined
                  }
                />
              ))}
              {devMode.chat.streamingMessage && (
                <MessageBubble
                  message={devMode.chat.streamingMessage as any}
                  streaming={true}
                  showModeLabel={showMessageModeLabels}
                  fontSize={fontSize}
                  onApprove={devMode.approval?.approve}
                  onReject={devMode.approval?.reject}
                  autoApproveEnabled={devMode.approval?.autoApproveEnabled}
                  previousMessage={
                    devMode.chat.messages.length > 0
                      ? devMode.chat.messages[devMode.chat.messages.length - 1]
                      : undefined
                  }
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

            {/* Scroll to bottom button - positioned at container level, above input */}
            {showButton && (
              <div
                className="absolute left-0 right-0 flex justify-center py-3 pointer-events-none"
                style={{
                  bottom: 0,
                  zIndex: 50,
                  animation: isExiting
                    ? "fadeOutDown 0.3s ease-out"
                    : "fadeInUp 0.3s ease-out",
                }}
              >
                <button
                  onClick={() => {
                    isAutoScrollingRef.current = true;
                    isAtBottomRef.current = true;
                    setIsNearBottom(true);
                    isExitingRef.current = true;
                    setIsExiting(true);
                    setTimeout(() => {
                      showButtonRef.current = false;
                      setShowButton(false);
                      setIsExiting(false);
                      isExitingRef.current = false;
                    }, 300);
                    messagesEndRef.current?.scrollIntoView({
                      behavior: "smooth",
                    });
                    setTimeout(() => {
                      isAutoScrollingRef.current = false;
                    }, 1000);
                  }}
                  className="flex items-center justify-center w-10 h-10 rounded-full shadow-lg transition-all hover:scale-110 pointer-events-auto"
                  style={{
                    backgroundColor:
                      theme === "light"
                        ? "rgba(255, 255, 255, 0.7)"
                        : "rgba(30, 30, 35, 0.7)",
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    border:
                      theme === "light"
                        ? "1px solid rgba(0, 0, 0, 0.1)"
                        : "1px solid rgba(255, 255, 255, 0.15)",
                    color: theme === "light" ? "#1a1a1a" : "#ffffff",
                  }}
                  aria-label="Scroll to bottom"
                >
                  <ArrowDown className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>

          <div className="mb-3 mt-4 w-full px-5">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                className="h-12 w-full rounded-full bg-card px-4 pr-16 text-sm text-foreground outline-none transition-all focus:border-slate-300 focus:ring-1 focus:ring-slate-300 focus:ring-offset-0"
                style={{
                  border:
                    devMode.mode === "edit"
                      ? "1px solid #eab308"
                      : theme === "light"
                        ? "1px solid hsl(0 0% 88%)"
                        : "1px solid hsl(0 0% 20%)",
                  boxShadow:
                    devMode.mode === "edit"
                      ? "0 0 0 1px rgba(234, 179, 8, 0.3)"
                      : undefined,
                }}
                placeholder={
                  devMode.mode === "edit"
                    ? "Describe the tools and capabilities your agent should have..."
                    : "Chat with your agent..."
                }
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
                aria-label="Send message"
                className={`absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full shadow ${
                  theme === "light"
                    ? "bg-slate-900 text-white hover:bg-slate-800"
                    : "bg-white text-slate-900 hover:bg-slate-100"
                }`}
              >
                <SendHorizonal className="h-4 w-4" />
                <span className="sr-only">Send</span>
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 px-5 pb-5 text-[11px] text-muted-foreground/60">
            <Tooltip
              content={
                devMode.mode === "edit"
                  ? "Describe what you want your agent to do"
                  : "Chat with your agent"
              }
            >
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded font-medium cursor-help ${
                  devMode.mode === "edit"
                    ? "bg-yellow-500/10 text-yellow-500"
                    : "bg-blue-500/10 text-blue-400"
                }`}
              >
                {devMode.mode === "edit" ? "Edit mode" : "Run mode"}
              </span>
            </Tooltip>
            <span>Ctrl+T: switch mode</span>
            <span>Ctrl+R: reset</span>
            <span>
              Esc: interrupt
              {devMode.chat.queuedMessages &&
                devMode.chat.queuedMessages.length > 0 && (
                  <span
                    className={theme === "dark" ? "text-white" : "text-black"}
                  >
                    {" "}
                    ({devMode.chat.queuedMessages.length}{" "}
                    {devMode.chat.queuedMessages.length === 1
                      ? "message"
                      : "messages"}{" "}
                    queued)
                  </span>
                )}
            </span>
          </div>
        </div>

        {showSourceBrowser && (
          <div
            className="relative flex flex-col border-l border-border bg-card"
            style={{
              animation: "slideInFromRight 0.2s ease-out",
              width: fileTreeWidth,
              minWidth: fileTreeWidth,
              overflow: "hidden",
              height: "100%",
            }}
          >
            <SourceBrowser
              fileTree={fileTree}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              fileContent={selectedFileContent}
              directory={directory}
              blinkVersion={blinkVersion}
              onClose={() => setShowSourceBrowser(false)}
              onToggleDirectory={handleToggleDirectory}
            />
            <div
              className={`absolute left-0 top-0 h-full w-1 cursor-col-resize ${
                isResizingFileTree ? "bg-border" : "bg-transparent"
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingFileTree(true);
              }}
            />
          </div>
        )}
      </div>

      <Dialog
        open={chatToDelete !== null}
        onOpenChange={(open) => !open && setChatToDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Chat</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this chat? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChatToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => chatToDelete && handleDeleteChat(chatToDelete)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent>
          <div style={{ width: "500px", maxWidth: "90vw" }}>
            <DialogHeader>
              <DialogTitle>Settings</DialogTitle>
              <DialogDescription>
                Configure your Blink Desktop preferences
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4">
              <div className="flex border-b border-border">
                <button
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    settingsTab === "general"
                      ? "border-b-2 border-foreground text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSettingsTab("general")}
                >
                  General
                </button>
                <button
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    settingsTab === "llm"
                      ? "border-b-2 border-foreground text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSettingsTab("llm")}
                >
                  LLM Keys
                </button>
                <button
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    settingsTab === "account"
                      ? "border-b-2 border-foreground text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSettingsTab("account")}
                >
                  Account
                </button>
              </div>

              <div className="mt-6 space-y-6">
                {settingsTab === "general" && (
                  <>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label
                            htmlFor="dark-mode"
                            className="text-sm font-medium text-foreground"
                          >
                            Dark Mode
                          </label>
                          <p className="text-xs text-muted-foreground">
                            Toggle between light and dark theme
                          </p>
                        </div>
                        <Switch
                          id="dark-mode"
                          checked={theme === "dark"}
                          onCheckedChange={(checked) =>
                            setTheme(checked ? "dark" : "light")
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label
                            htmlFor="message-mode-labels"
                            className="text-sm font-medium text-foreground"
                          >
                            Message Mode Labels
                          </label>
                          <p className="text-xs text-muted-foreground">
                            Show run/edit mode labels above messages
                          </p>
                        </div>
                        <Switch
                          id="message-mode-labels"
                          checked={showMessageModeLabels}
                          onCheckedChange={setShowMessageModeLabels}
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <label
                            htmlFor="font-size"
                            className="text-sm font-medium text-foreground"
                          >
                            Message Font Size
                          </label>
                          <p className="text-xs text-muted-foreground">
                            Adjust the size of message text
                          </p>
                        </div>
                        <Select
                          id="font-size"
                          value={fontSize}
                          onChange={(e) =>
                            setFontSize(
                              e.target.value as "small" | "medium" | "large"
                            )
                          }
                          className="w-28"
                        >
                          <option value="small">Small</option>
                          <option value="medium">Medium</option>
                          <option value="large">Large</option>
                        </Select>
                      </div>
                    </div>
                  </>
                )}

                {settingsTab === "llm" && (
                  <>
                    <div className="space-y-3">
                      <label className="text-sm font-medium text-foreground">
                        OpenAI API Key
                      </label>
                      <div className="relative">
                        <input
                          type={showOpenaiKey ? "text" : "password"}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground"
                          placeholder="sk-..."
                          value={openaiKey}
                          onChange={(e) => setOpenaiKey(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showOpenaiKey ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Your API key will be stored securely on your device
                      </p>
                    </div>

                    <div className="space-y-3">
                      <label className="text-sm font-medium text-foreground">
                        Anthropic API Key
                      </label>
                      <div className="relative">
                        <input
                          type={showAnthropicKey ? "text" : "password"}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground"
                          placeholder="sk-ant-..."
                          value={anthropicKey}
                          onChange={(e) => setAnthropicKey(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {showAnthropicKey ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Your API key will be stored securely on your device
                      </p>
                    </div>
                  </>
                )}

                {settingsTab === "account" && (
                  <>
                    <div className="space-y-4">
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/20">
                            <User className="h-6 w-6 text-blue-500" />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-foreground">
                              {auth.email || "Not signed in"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {auth.status === "authenticated"
                                ? "Connected to Blink"
                                : "No active session"}
                            </div>
                          </div>
                        </div>
                      </div>

                      {auth.status === "authenticated" && (
                        <>
                          <div className="rounded-md border border-border bg-muted/50 p-4">
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-foreground">
                                Sign out of Blink
                              </p>
                              <p className="text-xs text-muted-foreground">
                                If you still want to use Blink after signing
                                out, make sure you've added your own API keys
                                first.
                              </p>
                            </div>
                          </div>

                          <Button
                            variant="destructive"
                            className="w-full flex items-center justify-center gap-2"
                            onClick={() => {
                              auth.logout();
                              setShowSettings(false);
                            }}
                          >
                            <LogOut className="h-4 w-4" />
                            Sign Out
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSettings(false)}>
                Close
              </Button>
              <Button
                onClick={handleSaveSettings}
                style={{
                  backgroundColor: theme === "dark" ? "white" : "#1f2937",
                  color: theme === "dark" ? "black" : "white",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor =
                    theme === "dark" ? "#e5e7eb" : "#374151";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor =
                    theme === "dark" ? "white" : "#1f2937";
                }}
              >
                Save Changes
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Switch Agent Error Dialog */}
      <Dialog
        open={!!switchAgentError}
        onOpenChange={(open) => !open && onDismissSwitchAgentError?.()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invalid Agent Folder</DialogTitle>
            <DialogDescription>{switchAgentError}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={onDismissSwitchAgentError}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
