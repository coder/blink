"use client";

import { cn } from "@/lib/utils";
import Client from "@blink.so/api";
import "@xterm/xterm/css/xterm.css";
import type { ToolApprovalOutput } from "blink";
import { motion } from "framer-motion";
import {
  Calculator,
  CheckCircle,
  Code,
  Database,
  ExternalLink,
  File,
  FileText,
  Folder,
  Github,
  GitPullRequest,
  Globe,
  Hash,
  Image as ImageIcon,
  Package,
  Search,
  Terminal,
  Users,
  Wrench,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { CodeIcon, LoaderIcon, SlackIcon } from "./icons";
import { Markdown } from "./markdown";
import { Button } from "./ui/button";
import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";

type NativeTools = any;
type ToolUIPart<T = any, S = any> = any;

// Persist speech progress per toolCallId so we can continue across re-mounts
const speechProgressByToolCallId = new Map<string, number>();

// Utility functions for file handling
const getFileExtension = (filename: string) => {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1]?.toLowerCase() : "";
};

const getFileTypeIcon = (filename: string) => {
  const ext = getFileExtension(filename);

  // Programming languages
  if (["js", "jsx", "ts", "tsx", "mjs"].includes(ext)) return Code;
  if (["py", "python"].includes(ext)) return Code;
  if (["java", "kt", "scala"].includes(ext)) return Code;
  if (["cpp", "c", "h", "hpp"].includes(ext)) return Code;
  if (["rs", "go", "php", "rb"].includes(ext)) return Code;

  // Web files
  if (["html", "htm", "css", "scss", "sass"].includes(ext)) return Code;

  // Data/Config files
  if (["json", "xml", "yaml", "yml", "toml"].includes(ext)) return Database;
  if (["csv", "tsv"].includes(ext)) return Database;

  // Documentation
  if (["md", "mdx", "txt", "rst"].includes(ext)) return FileText;

  // Images
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext))
    return ImageIcon;

  return File; // Default file icon
};

const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const truncateText = (text: string, maxLength: number) => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
};

// Get motif icon for github tools
const getGithubMotifIcon = (toolName: string) => {
  switch (toolName) {
    case "github_search_issues":
    case "github_search_repositories":
    case "github_search_code":
      return Search;
    case "github_get_pull_request":
    case "github_get_pull_request_diff":
    case "github_list_pull_request_files":
      return GitPullRequest;
    case "github_list_repository_contributors":
      return Users;
    case "github_repository_read_file":
    case "github_repository_list_directory":
    case "github_repository_find_files":
      return File;
    default:
      return null;
  }
};

// Render tool icon with optional motif
const renderToolIcon = (
  toolName: string,
  size: number = 14,
  iconColor: string
) => {
  if (toolName.startsWith("github_")) {
    const MotifIcon = getGithubMotifIcon(toolName);

    return (
      <div className="relative">
        <Github size={size} className={iconColor} />
        {MotifIcon && (
          <MotifIcon
            size={6}
            className={cn("absolute -bottom-0.5 -right-0.5", iconColor)}
          />
        )}
      </div>
    );
  }

  if (toolName === "compress-context") {
    return <Package size={size} className={iconColor} />;
  }

  if (toolName.startsWith("workspace_")) {
    return <Terminal size={size} className={iconColor} />;
  }

  if (toolName === "calculate") {
    return <Calculator size={size} className={iconColor} />;
  }

  if (toolName === "search_web") {
    return <Globe size={size} className={iconColor} />;
  }

  if (toolName.startsWith("image_")) {
    return <ImageIcon size={size} className={iconColor} />;
  }

  if (toolName.startsWith("browser_")) {
    return <Globe size={size} className={iconColor} />;
  }

  if (toolName.startsWith("slackbot_")) {
    if (toolName === "slackbot_send_message") {
      return <SlackIcon size={size} className={iconColor} />;
    }
    if (toolName === "slackbot_react_to_message") {
      return <Hash size={size} className={iconColor} />;
    }
  }

  return <CodeIcon size={size} />;
};

// Get result preview for specific tool types
const getResultPreview = (toolInvocation: ToolUIPart<keyof NativeTools>) => {
  if (toolInvocation.state !== "output-available") {
    return null;
  }
  if (!toolInvocation.output) {
    return null;
  }
  if (
    typeof toolInvocation.output === "object" &&
    "error" in toolInvocation.output
  ) {
    return null;
  }

  switch (toolInvocation.type) {
    case "tool-workspace_bash":
      if (
        "still_running" in toolInvocation.output &&
        toolInvocation.output.still_running
      ) {
        return {
          text: "Running in the background",
          isRunning: true,
        };
      } else if (
        "exit_code" in toolInvocation.output &&
        "duration_ms" in toolInvocation.output
      ) {
        const exitCode = toolInvocation.output.exit_code;
        return {
          text: `Completed in ${toolInvocation.output.duration_ms}ms`,
          exitCode: exitCode,
        };
      }
      break;

    case "tool-github_search_issues":
      if (toolInvocation.output.total_count) {
        return {
          text: `${toolInvocation.output.total_count} issue${toolInvocation.output.total_count !== 1 ? "s" : ""} found`,
        };
      }
      break;

    case "tool-github_search_repositories":
      if (toolInvocation.output.total_count) {
        return {
          text: `${toolInvocation.output.total_count} repositor${toolInvocation.output.total_count !== 1 ? "ies" : "y"} found`,
        };
      }
      break;

    case "tool-github_search_code":
      if (toolInvocation.output.total_count) {
        return {
          text: `${toolInvocation.output.total_count} result${toolInvocation.output.total_count !== 1 ? "s" : ""} found`,
        };
      }
      break;

    case "tool-github_list_repository_contributors":
      if (Array.isArray(toolInvocation.output.contributors)) {
        return {
          text: `${toolInvocation.output.contributors.length} contributor${toolInvocation.output.contributors.length !== 1 ? "s" : ""}`,
        };
      }
      break;

    case "tool-github_repository_find_files":
    case "tool-github_repository_list_directory":
      if (Array.isArray(toolInvocation.output.files)) {
        return {
          text: `${toolInvocation.output.files.length} file${toolInvocation.output.files.length !== 1 ? "s" : ""}`,
        };
      }
      break;

    case "tool-github_list_pull_request_files":
      if (Array.isArray(toolInvocation.output.files)) {
        return {
          text: `${toolInvocation.output.files.length} file${toolInvocation.output.files.length !== 1 ? "s" : ""} changed`,
        };
      }
      break;

    case "tool-search_web":
      if (Array.isArray(toolInvocation.output.results)) {
        return {
          text: `${toolInvocation.output.results.length} result${toolInvocation.output.results.length !== 1 ? "s" : ""} found`,
        };
      }
      break;

    case "tool-workspace_read_file":
    case "tool-github_repository_read_file":
      if ("total_lines" in toolInvocation.output) {
        return {
          text: `${toolInvocation.output.total_lines} lines`,
        };
      }
      break;

    case "tool-workspace_write_file":
    case "tool-workspace_edit_file":
      return {
        text: "File updated",
      };

    case "tool-browser_take_screenshot":
      return {
        text: "Screenshot captured",
      };

    case "tool-browser_navigate":
      return {
        text: "Page loaded",
      };
  }

  return null;
};

const PureToolCall = ({
  toolInvocation,
  isStreaming = false,
  isLatestMessage = false,
  message,
}: {
  toolInvocation: ToolUIPart;
  isStreaming?: boolean;
  isLatestMessage?: boolean;
  message: UIMessage;
}) => {
  const { state } = toolInvocation;
  const resultPreview = getResultPreview(toolInvocation);
  const getIconColor = useCallback(() => {
    // Check for interrupted tool calls - tool call is incomplete, chat not streaming, and this isn't the latest message being processed
    const isInterrupted =
      !isStreaming &&
      (state === "input-streaming" || state === "input-available");

    if (isInterrupted) {
      return "text-red-600 dark:text-red-400";
    }

    switch (state) {
      case "input-streaming":
      case "input-available":
        return "text-blue-600 dark:text-blue-400";
      case "output-available":
        if (
          toolInvocation.state === "output-available" &&
          "output" in toolInvocation
        ) {
          const { output } = toolInvocation;
          if (typeof output === "object" && output && "error" in output) {
            return "text-red-600 dark:text-red-400";
          }
        }
        return "text-zinc-500 dark:text-zinc-400"; // Default color for success
      default:
        return "text-zinc-500 dark:text-zinc-400";
    }
  }, [state, toolInvocation, isStreaming]);

  const modelIntent = toolInvocation.input?.model_intent
    ? toolInvocation.input.model_intent.charAt(0).toUpperCase() +
      toolInvocation.input.model_intent.slice(1)
    : undefined;

  let displayModelIntent = true;
  // Since this is displaying anyways, we don't want to display the model intent.
  if (toolInvocation.type.startsWith("tool-display_")) {
    displayModelIntent = false;
  }

  const isToolApproval =
    toolInvocation.state === "output-available" &&
    isToolApprovalOutput(toolInvocation.output);

  // Developer mode when no model_intent is available
  const isDeveloperMode = !modelIntent && displayModelIntent && !isToolApproval;

  return (
    <div className="flex flex-col items-start pb-2 text-md max-w-full w-full">
      {displayModelIntent && (
        <div className="flex flex-row gap-3 items-center">
          {isStreaming && state !== "output-available" ? (
            <div className="animate-spin -mt-0.5">
              <LoaderIcon size={12} />
            </div>
          ) : (
            <div className="-mt-0.5">
              {isDeveloperMode ? (
                <Wrench size={12} className={getIconColor()} />
              ) : isToolApproval ? null : (
                renderToolIcon(getToolName(toolInvocation), 12, getIconColor())
              )}
            </div>
          )}
          <span className="text-zinc-700 dark:text-zinc-300 min-w-0">
            <div className="flex flex-wrap whitespace-normal break-words max-w-full">
              {isDeveloperMode ? (
                // Developer mode: show tool name
                <span className="font-mono text-sm">
                  {getToolName(toolInvocation).replace("tool-", "")}
                </span>
              ) : modelIntent?.length && isStreaming ? (
                modelIntent.split("").map((char: string, index: number) => (
                  <motion.span
                    key={index}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: 0.4,
                      delay: index * 0.01,
                      ease: "easeOut",
                    }}
                    style={{
                      display: "inline-block",
                      minWidth: char === " " ? "0.25em" : "auto",
                    }}
                  >
                    {char}
                  </motion.span>
                ))
              ) : modelIntent?.length ? (
                <span>{modelIntent}</span>
              ) : null}
            </div>
          </span>
        </div>
      )}

      {/* Developer mode: show input */}
      {isDeveloperMode && toolInvocation.input && (
        <div className="mt-2 w-full">
          <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md p-3">
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mb-2">
              Input
            </div>
            <pre className="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(toolInvocation.input, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Developer mode: show result */}
      {isDeveloperMode &&
        toolInvocation.state === "output-available" &&
        toolInvocation.output && (
          <div className="mt-2 w-full">
            <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md p-3">
              <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mb-2">
                Result
              </div>
              <pre className="text-xs font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
                {JSON.stringify(toolInvocation.output, null, 2)}
              </pre>
            </div>
          </div>
        )}

      {toolInvocation.type === "tool-todo_write" && (
        <div className="mt-2 space-y-1">
          {/* @ts-ignore */}
          {toolInvocation.args?.parameters?.todos?.map((todo) => (
            <div key={todo.id} className="flex items-center gap-2">
              <div className="flex items-center">
                {todo.status === "completed" ? (
                  <div className="w-3 h-3 rounded bg-green-800 flex items-center justify-center">
                    <svg
                      className="w-2 h-2 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                ) : (
                  <div
                    className={cn(
                      "w-3 h-3 rounded border flex items-center justify-center",
                      todo.status === "in_progress"
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                        : "border-zinc-300 dark:border-zinc-600"
                    )}
                  >
                    {todo.status === "in_progress" && (
                      <div className="w-1 h-1 rounded-full bg-blue-500" />
                    )}
                  </div>
                )}
              </div>
              <span
                className={cn(
                  "flex-1",
                  todo.status === "completed"
                    ? "line-through decoration-zinc-300 dark:decoration-zinc-600 decoration-1 text-zinc-400 dark:text-zinc-500"
                    : "text-zinc-600 dark:text-zinc-400"
                )}
              >
                {todo.content}
              </span>
              {todo.priority === "high" && (
                <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
              )}
            </div>
          ))}
        </div>
      )}
      {toolInvocation.type === "tool-fetch_image" &&
        toolInvocation.state === "output-available" && (
          <FetchImageToolPreview toolInvocation={toolInvocation} />
        )}

      {toolInvocation.type === "tool-generate_image" &&
        toolInvocation.state === "output-available" && (
          <GenerateImageToolPreview toolInvocation={toolInvocation} />
        )}

      {toolInvocation.type === "tool-browser_navigate" &&
        toolInvocation.state === "output-available" && (
          <BrowserNavigateToolPreview toolInvocation={toolInvocation} />
        )}

      {toolInvocation.type === "tool-search_web" &&
        toolInvocation.state === "output-available" && (
          <WebSearchToolPreview toolInvocation={toolInvocation} />
        )}

      {(toolInvocation.type === "tool-workspace_read_file" ||
        toolInvocation.type === "tool-github_repository_read_file") &&
        toolInvocation.state === "output-available" && (
          <FileOperationToolPreview toolInvocation={toolInvocation} />
        )}

      {(toolInvocation.type === "tool-workspace_write_file" ||
        toolInvocation.type === "tool-workspace_edit_file") &&
        toolInvocation.state === "output-available" && (
          <WorkspaceEditDiffToolPreview toolInvocation={toolInvocation} />
        )}

      {(toolInvocation.type === "tool-workspace_process_wait" ||
        toolInvocation.type === "tool-workspace_process_read_output" ||
        toolInvocation.type === "tool-workspace_process_grep_output") &&
        toolInvocation.state === "output-available" && (
          <WorkspaceProcessToolPreview toolInvocation={toolInvocation} />
        )}

      {toolInvocation.type === "tool-github_repository_list_directory" &&
        toolInvocation.state === "output-available" && (
          <DirectoryListingToolPreview toolInvocation={toolInvocation} />
        )}

      {toolInvocation.type === "tool-github_get_repository" &&
        toolInvocation.state === "output-available" && (
          <GithubRepositoryToolPreview toolInvocation={toolInvocation} />
        )}

      {(toolInvocation.type === "tool-github_search_repositories" ||
        toolInvocation.type === "tool-github_search_issues") &&
        toolInvocation.state === "output-available" && (
          <GithubSearchToolPreview toolInvocation={toolInvocation} />
        )}

      {(toolInvocation.type === "tool-github_get_issue" ||
        toolInvocation.type === "tool-github_get_pull_request") &&
        toolInvocation.state === "output-available" && (
          <GithubIssueToolPreview toolInvocation={toolInvocation} />
        )}

      {toolInvocation.type === "tool-slackbot_send_message" &&
        toolInvocation.state === "output-available" && (
          <SlackbotSendMessageToolPreview toolInvocation={toolInvocation} />
        )}

      {toolInvocation.state === "output-available" &&
        isToolApprovalOutput(toolInvocation.output) && (
          <ToolApprovalToolPreview
            toolInvocation={toolInvocation}
            message={message}
          />
        )}

      {resultPreview && (
        <div className="flex items-center gap-1.5 mt-1">
          {("exitCode" in resultPreview &&
            resultPreview.exitCode !== undefined) ||
          ("isRunning" in resultPreview && resultPreview.isRunning) ? (
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                "isRunning" in resultPreview && resultPreview.isRunning
                  ? "bg-blue-600"
                  : resultPreview.exitCode === 0
                    ? "bg-green-800"
                    : "bg-red-800"
              )}
            />
          ) : null}
          <span className="text-zinc-400 dark:text-zinc-500 text-xs">
            {resultPreview.text}
          </span>
        </div>
      )}
    </div>
  );
};

const FileBadge = ({
  filename,
  size,
  lines,
  isDirectory = false,
}: {
  filename: string;
  size?: number;
  lines?: number;
  isDirectory?: boolean;
}) => {
  const FileIcon = isDirectory ? Folder : getFileTypeIcon(filename);
  const displayName = truncateText(filename.split("/").pop() || filename, 20);

  return (
    <div className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs border">
      <FileIcon size={10} className="text-zinc-500 dark:text-zinc-400" />
      <span className="text-zinc-700 dark:text-zinc-300 font-medium">
        {displayName}
      </span>
      {size && (
        <span className="text-zinc-500 dark:text-zinc-400">
          {formatFileSize(size)}
        </span>
      )}
      {lines && (
        <span className="text-zinc-500 dark:text-zinc-400">{lines} lines</span>
      )}
    </div>
  );
};

const ToolApprovalToolPreview = ({
  toolInvocation,
  message,
}: {
  toolInvocation: ToolUIPart<any, "output-available">;
  message: UIMessage;
}) => {
  if (!isToolApprovalOutput(toolInvocation.output)) {
    return null;
  }

  const { outcome, reason } = toolInvocation.output;
  const client = useMemo(() => new Client(), []);
  const [isLoading, setIsLoading] = useState(false);

  const updateMessage = (outcome: "approved" | "rejected") => {
    setIsLoading(true);
    client.messages
      .update({
        message_id: message.id,
        behavior: "interrupt",
        parts: message.parts.map((part) => {
          if (!isToolUIPart(part)) {
            return part;
          }
          if (part.toolCallId !== toolInvocation.toolCallId) {
            return part;
          }
          if (!isToolApprovalOutput(part.output)) {
            return part;
          }
          const output: ToolApprovalOutput = {
            type: "tool-approval",
            outcome,
            reason:
              outcome === "approved" ? "Approved by user" : "Rejected by user",
          };
          return {
            ...part,
            output,
            errorText: undefined,
            state: "output-available",
          };
        }),
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const toolLabel = useMemo(
    () => getToolName(toolInvocation).replace("tool-", ""),
    [toolInvocation]
  );

  const inputLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    const params = toolInvocation.input as Record<string, unknown> | undefined;
    if (!params || typeof params !== "object") return labels;
    Object.entries(params).forEach(([key, value]) => {
      labels[key] = JSON.stringify(value);
    });
    return labels;
  }, [toolInvocation.input]);

  const statusColor =
    outcome === "approved"
      ? "bg-green-700"
      : outcome === "rejected"
        ? "bg-red-700"
        : "bg-yellow-500";

  return (
    <div className="mt-2 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="-mt-0.5">
            {renderToolIcon(
              getToolName(toolInvocation),
              12,
              "text-zinc-500 dark:text-zinc-400"
            )}
          </span>
          <span className="text-zinc-700 dark:text-zinc-300 font-medium truncate">
            {toolLabel}
          </span>
        </div>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs border">
          <span className={cn("w-1.5 h-1.5 rounded-full", statusColor)} />
          <span className="text-zinc-700 dark:text-zinc-300 capitalize">
            {outcome}
          </span>
        </span>
      </div>

      {Object.keys(inputLabels).length > 0 && (
        <div className="mt-2">
          <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium mb-1">
            Parameters
          </div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(inputLabels).map(([key, value]) => (
              <span
                key={key}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs border"
              >
                <code className="text-zinc-600 dark:text-zinc-300">{key}</code>
                <span className="text-zinc-400 dark:text-zinc-500">=</span>
                <code className="text-zinc-600 dark:text-zinc-300 break-all">
                  {value}
                </code>
              </span>
            ))}
          </div>
        </div>
      )}

      {outcome !== "pending" && reason && (
        <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          {reason}
        </div>
      )}

      {outcome === "pending" && (
        <div className="flex items-center gap-2 mt-2">
          <Button
            onClick={() => updateMessage("approved")}
            disabled={isLoading}
          >
            Approve
          </Button>
          <Button
            variant="destructive"
            onClick={() => updateMessage("rejected")}
            disabled={isLoading}
          >
            Reject
          </Button>
        </div>
      )}
    </div>
  );
};

const WebSearchToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<"search_web", "output-available">;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }

  const results = toolInvocation.output.results.slice(0, 4); // Show top 4 results

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1">
        {results.map((result: any, index: number) => {
          const domain = new URL(result.url).hostname.replace("www.", "");
          const displayTitle = truncateText(result.title, 25);

          return (
            <a
              key={index}
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs border hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              {result.image ? (
                <img
                  src={result.image}
                  alt=""
                  className="w-2.5 h-2.5 rounded-sm object-cover"
                  onError={(e) => {
                    // Replace with ExternalLink icon on error
                    const parent = e.currentTarget.parentNode;
                    if (parent) {
                      e.currentTarget.style.display = "none";
                      const fallbackIcon = document.createElement("div");
                      fallbackIcon.innerHTML =
                        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-500 dark:text-zinc-400"><path d="m7 7 10 10-5 5-5-5 5-5"/><path d="M20.83 8.83a4 4 0 0 0-5.66-5.66l-4 4a4 4 0 0 0 5.66 5.66l4-4z"/></svg>';
                      parent.insertBefore(
                        fallbackIcon.firstChild as Node,
                        e.currentTarget.nextSibling
                      );
                    }
                  }}
                />
              ) : (
                <ExternalLink
                  size={10}
                  className="text-zinc-500 dark:text-zinc-400"
                />
              )}
              <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                {displayTitle}
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">{domain}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
};

const FileOperationToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<
    "workspace_read_file" | "github_repository_read_file",
    "output-available"
  >;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }

  const filename =
    toolInvocation.input?.parameters?.file_path || "Unknown file";
  const totalLines =
    "total_lines" in toolInvocation.output
      ? toolInvocation.output.total_lines
      : undefined;

  return (
    <div className="mt-2">
      <FileBadge filename={filename} lines={totalLines} />
    </div>
  );
};

const WorkspaceEditDiffToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<
    "workspace_write_file" | "workspace_edit_file",
    "output-available"
  >;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }

  const filename =
    toolInvocation.input?.parameters?.file_path || "Unknown file";
  const isEdit = toolInvocation.type === "tool-workspace_edit_file";

  const buildUnifiedDiff = (
    filePath: string,
    hunks: Array<{
      old_start: number;
      old_end: number;
      new_start: number;
      new_end: number;
      lines?: string[];
    }>
  ) => {
    const header = [`--- a/${filePath}`, `+++ b/${filePath}`];
    const body = hunks.flatMap((h) => {
      const header = `@@ -${h.old_start},${h.old_end} +${h.new_start},${h.new_end} @@`;
      const lines = (h as any).lines ?? [];
      return [header, ...lines];
    });
    return [...header, ...body].join("\n");
  };

  const renderDiff = () => {
    const sp = (toolInvocation.output as any).structured_patch;
    if (!Array.isArray(sp) || sp.length === 0) return null;

    const diffText = buildUnifiedDiff(filename, sp);
    let files: any[] = [];
    try {
      files = parseDiff(diffText);
    } catch (e) {
      return null;
    }
    const file = files[0];
    if (!file) return null;

    const diffStyles = `
      .diff { font-family: ui-monospace, SFMono-Regular, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; line-height: 1.5; border: none; background: transparent; }
      .diff-gutter { background-color: rgb(250 250 249); border-right: 1px solid rgb(231 229 228); color: rgb(120 113 108); font-size: 12px; padding: 0 8px; text-align: right; user-select: none; width: 46px; vertical-align: top; }
      .dark .diff-gutter { background-color: rgb(41 37 36); border-right-color: rgb(68 64 60); color: rgb(168 162 158); }
      .diff-code { padding: 0 12px; white-space: pre; vertical-align: top; background-color: rgb(255 255 255); }
      .dark .diff-code { background-color: rgb(28 25 23); }
      .diff-gutter-insert { background-color: rgb(240 253 244); border-right-color: rgb(34 197 94); }
      .dark .diff-gutter-insert { background-color: rgb(20 83 45); border-right-color: rgb(34 197 94); }
      .diff-code-insert { background-color: rgb(240 253 244); }
      .dark .diff-code-insert { background-color: rgb(20 83 45); }
      .diff-gutter-delete { background-color: rgb(254 242 242); border-right-color: rgb(239 68 68); }
      .dark .diff-gutter-delete { background-color: rgb(127 29 29); border-right-color: rgb(239 68 68); }
      .diff-code-delete { background-color: rgb(254 242 242); }
      .dark .diff-code-delete { background-color: rgb(127 29 29); }
      .diff-line:hover .diff-gutter, .diff-line:hover .diff-code { background-color: rgb(245 245 244) !important; }
      .dark .diff-line:hover .diff-gutter, .dark .diff-line:hover .diff-code { background-color: rgb(44 39 56) !important; }
      .diff-decoration { background-color: rgb(250 250 249); border-bottom: 1px solid rgb(231 229 228); }
      .dark .diff-decoration { background-color: rgb(41 37 36); border-bottom-color: rgb(68 64 60); }
      .diff-widget { border: none; }
      .diff-widget-content { padding: 0; }
      /* Improve text selection contrast inside diffs (including Firefox) */
      .diff ::selection { background-color: rgba(59,130,246,0.30); color: inherit; }
      .diff ::-moz-selection { background-color: rgba(59,130,246,0.30); color: inherit; }
      .dark .diff ::selection { background-color: rgba(59,130,246,0.40); color: inherit; }
      .dark .diff ::-moz-selection { background-color: rgba(59,130,246,0.40); color: inherit; }
      /* Keep consistent selection over added/removed lines */
      .diff .diff-code-insert ::selection, .diff .diff-gutter-insert ::selection { background-color: rgba(59,130,246,0.34); }
      .diff .diff-code-delete ::selection, .diff .diff-gutter-delete ::selection { background-color: rgba(59,130,246,0.34); }
      .dark .diff .diff-code-insert ::selection, .dark .diff .diff-gutter-insert ::selection { background-color: rgba(59,130,246,0.44); }
      .dark .diff .diff-code-delete ::selection, .dark .diff .diff-gutter-delete ::selection { background-color: rgba(59,130,246,0.44); }
    `;

    return (
      <div className="mt-2 w-full max-w-full overflow-auto rounded border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
        <style dangerouslySetInnerHTML={{ __html: diffStyles }} />
        <div className="min-w-[320px]">
          <Diff
            viewType="unified"
            diffType={file.type}
            hunks={file.hunks}
            className="text-sm"
          >
            {(hunks) =>
              hunks.map((hunk, idx) => <Hunk key={idx} hunk={hunk} />)
            }
          </Diff>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <FileBadge filename={filename} />
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-xs border">
          <CheckCircle size={10} />
          {isEdit ? "Modified" : "Created"}
        </span>
      </div>
      {isEdit && renderDiff()}
    </div>
  );
};

const WorkspaceProcessToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<
    | "workspace_process_wait"
    | "workspace_process_read_output"
    | "workspace_process_grep_output",
    "output-available"
  >;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }

  const isWait = toolInvocation.type === "tool-workspace_process_wait";
  const isGrep = toolInvocation.type === "tool-workspace_process_grep_output";
  const isRead = toolInvocation.type === "tool-workspace_process_read_output";

  // For workspace_process_wait, show like the original bash completion style
  if (isWait) {
    let text = "";
    let exitCode: number | undefined;
    let isRunning = false;

    if (
      "still_running" in toolInvocation.output &&
      toolInvocation.output.still_running
    ) {
      text = "Running in the background";
      isRunning = true;
    } else if (
      "duration_ms" in toolInvocation.output &&
      toolInvocation.output.duration_ms
    ) {
      text = `Completed in ${toolInvocation.output.duration_ms}ms`;
      exitCode =
        "exit_code" in toolInvocation.output
          ? toolInvocation.output.exit_code
          : undefined;
    }

    if (text) {
      return (
        <div className="flex items-center gap-1.5 mt-1">
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              isRunning
                ? "bg-blue-600"
                : exitCode === 0
                  ? "bg-green-800"
                  : "bg-red-800"
            )}
          />
          <span className="text-zinc-400 dark:text-zinc-500 text-xs">
            {text}
          </span>
        </div>
      );
    }
  }

  // For other process tools, show simple info
  if (isGrep && "total_matches" in toolInvocation.output) {
    const pattern = toolInvocation.input?.parameters?.pattern || "";
    const truncatedPattern = truncateText(pattern, 20);

    return (
      <div className="mt-2">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-xs border">
          <Search size={10} />
          {toolInvocation.output.total_matches} matches
          {truncatedPattern && (
            <>
              <span className="text-zinc-400 dark:text-zinc-500">for</span>
              <code className="text-zinc-600 dark:text-zinc-300">
                {truncatedPattern}
              </code>
            </>
          )}
        </span>
      </div>
    );
  }

  if (
    isRead &&
    "lines_read" in toolInvocation.output &&
    "start_line" in toolInvocation.output
  ) {
    const startLine = toolInvocation.output.start_line;
    const endLine = startLine + toolInvocation.output.lines_read - 1;

    return (
      <div className="mt-2">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-xs border">
          <FileText size={10} />
          Lines {startLine}-{endLine}
        </span>
      </div>
    );
  }

  return null;
};

const DirectoryListingToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<
    "github_repository_list_directory",
    "output-available"
  >;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }

  if (
    !("files" in toolInvocation.output) ||
    !Array.isArray(toolInvocation.output.files)
  ) {
    return null;
  }

  const files = toolInvocation.output.files.slice(0, 5); // Show first 5 files
  const hasMore = toolInvocation.output.files.length > 5;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1">
        {files.map((file: any, index: number) => {
          const filename = file.path || file.name || `item-${index}`;
          const size = file.size;
          const isDirectory = file.type === "directory" || file.type === "dir";

          return (
            <FileBadge
              key={index}
              filename={filename}
              size={size}
              isDirectory={isDirectory}
            />
          );
        })}
        {hasMore && (
          <div className="inline-flex items-center px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs border">
            <span className="text-zinc-500 dark:text-zinc-400">
              +{toolInvocation.output.files.length - 5} more
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const GithubRepositoryToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<"github_get_repository", "output-available">;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }

  const repo = toolInvocation.output;
  const owner = toolInvocation.input?.parameters?.owner;
  const repoName = toolInvocation.input?.parameters?.repo || repo.name;
  const fullName = owner ? `${owner}/${repoName}` : repo.name;
  const repoUrl = `https://github.com/${fullName}`;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1">
        <a
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-xs border hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
        >
          <Github size={10} />
          {truncateText(fullName, 25)}
          {repo.visibility === "private" && (
            <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 px-1 py-0.5 rounded ml-1">
              Private
            </span>
          )}
        </a>
        {repo.language && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-xs border">
            <Code size={10} />
            {repo.language}
          </span>
        )}
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-xs border">
          ⭐ {repo.stargazers_count}
        </span>
      </div>
    </div>
  );
};

const GithubSearchToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<
    "github_search_repositories" | "github_search_issues",
    "output-available"
  >;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }

  const isRepositorySearch =
    toolInvocation.type === "tool-github_search_repositories";
  const items =
    "items" in toolInvocation.output
      ? toolInvocation.output.items.slice(0, 4)
      : [];

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1">
        {items.map((item: any, index: number) => {
          return (
            <a
              key={index}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-xs border hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              {isRepositorySearch ? (
                <>
                  <Github size={10} />
                  {truncateText(item.name, 20)}
                  {item.language && (
                    <>
                      <span className="text-zinc-400 dark:text-zinc-500">
                        •
                      </span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {item.language}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <>
                  <span>#{item.number}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {truncateText(item.title, 25)}
                  </span>
                </>
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
};

const GithubIssueToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<
    "github_get_issue" | "github_get_pull_request",
    "output-available"
  >;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }

  const isPR = toolInvocation.type === "tool-github_get_pull_request";
  const issue = toolInvocation.output;
  const owner = toolInvocation.input?.parameters?.owner;
  const repo = toolInvocation.input?.parameters?.repo;
  const url =
    owner && repo
      ? `https://github.com/${owner}/${repo}/${isPR ? "pull" : "issues"}/${issue.number}`
      : undefined;

  const statusText = (issue as any).state === "merged" ? "merged" : issue.state;
  const statusColor =
    issue.state === "open"
      ? "text-green-600 dark:text-green-400"
      : issue.state === "closed"
        ? "text-red-600 dark:text-red-400"
        : "text-purple-600 dark:text-purple-400";

  return (
    <div className="mt-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded text-xs border hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
      >
        <span>#{issue.number}</span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {truncateText(issue.title, 25)}
        </span>
        <span className="text-zinc-400 dark:text-zinc-500">•</span>
        <span className={statusColor}>{statusText}</span>
        {issue.user?.login && (
          <>
            <span className="text-zinc-400 dark:text-zinc-500">•</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {issue.user.login}
            </span>
          </>
        )}
      </a>
    </div>
  );
};

const BrowserNavigateToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<"browser_navigate", "output-available">;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }

  const url = toolInvocation.input?.parameters?.url;
  if (!url) return null;

  const domain = new URL(url).hostname.replace("www.", "");

  return (
    <div className="mt-2">
      <div className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs border">
        <Globe size={10} className="text-zinc-500 dark:text-zinc-400" />
        <span className="text-zinc-700 dark:text-zinc-300 font-medium">
          {domain}
        </span>
        <ExternalLink size={8} className="text-zinc-400 dark:text-zinc-500" />
      </div>
    </div>
  );
};

const FetchImageToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<"fetch_image", "output-available">;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }
  let result = toolInvocation.output;
  if (Array.isArray(result)) {
    result = result[0];
  }
  return (
    <div className="mt-2 max-w-full">
      <div className="border rounded-md bg-zinc-50 dark:bg-zinc-900 p-1 overflow-hidden max-w-full">
        <img
          src={`data:${result.mimeType};base64,${result.data}`}
          alt="Fetched image"
          className="w-full h-auto max-w-full rounded border border-zinc-200 dark:border-zinc-700 shadow-sm"
        />
      </div>
    </div>
  );
};

const GenerateImageToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<"generate_image", "output-available">;
}) => {
  if ("error" in toolInvocation.output) {
    return null;
  }
  let result = toolInvocation.output;
  if (Array.isArray(result)) {
    result = result[0];
  }
  return (
    <div className="mt-2 max-w-full">
      <div className="border rounded-md bg-zinc-50 dark:bg-zinc-900 p-2 overflow-hidden max-w-full">
        <img
          src={result.public_url}
          alt="Generated image"
          className="w-full h-auto max-w-full rounded border border-zinc-200 dark:border-zinc-700 shadow-sm"
        />
      </div>
    </div>
  );
};

const SlackbotSendMessageToolPreview = ({
  toolInvocation,
}: {
  toolInvocation: ToolUIPart<"slackbot_send_message", "output-available">;
}) => {
  if (
    toolInvocation.state !== "output-available" ||
    !toolInvocation.output ||
    "error" in toolInvocation.output
  ) {
    return null;
  }

  const message = toolInvocation.input?.parameters?.message;

  if (!message) return null;

  return (
    <div className="mt-2">
      <div className="p-4 border-l-4">
        <Markdown>{message}</Markdown>
      </div>
    </div>
  );
};

export const ToolCall = memo(PureToolCall, (prevProps, nextProps) => {
  const prev = prevProps.toolInvocation;
  const next = nextProps.toolInvocation;

  return (
    prev.toolCallId === next.toolCallId &&
    prev.state === next.state &&
    prev.type === next.type &&
    prevProps.toolInvocation.input === nextProps.toolInvocation.input &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.isLatestMessage === nextProps.isLatestMessage
  );
});

function isToolApprovalOutput(output: unknown): output is ToolApprovalOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    "type" in output &&
    output.type === "tool-approval"
  );
}
