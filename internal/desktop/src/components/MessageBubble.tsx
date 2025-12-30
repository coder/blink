import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import type { UIMessage } from "ai";
import { getToolOrDynamicToolName, isToolOrDynamicToolUIPart } from "ai";

// Declare electron API for opening external links
declare const require: any;

// Helper to check if output is a tool approval
function isToolApprovalOutput(
  output: any
): output is { outcome: "pending" | "approved" | "rejected" } {
  return (
    typeof output === "object" &&
    output !== null &&
    "outcome" in output &&
    typeof output.outcome === "string" &&
    ["pending", "approved", "rejected"].includes(output.outcome)
  );
}

const ToolCallDisplay = ({
  part,
  streaming,
  fontSize = "medium",
  onApprove,
  onReject,
  autoApproveEnabled,
}: {
  part: any;
  streaming: boolean;
  fontSize?: "small" | "medium" | "large";
  onApprove?: (autoApprove?: boolean) => void;
  onReject?: () => void;
  autoApproveEnabled?: boolean;
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [needsExpand, setNeedsExpand] = React.useState(false);

  // Font size mapping for tool calls
  const fontSizeMap = {
    small: "12px",
    medium: "13px",
    large: "14px",
  };

  const name = getToolOrDynamicToolName(part);
  const state = React.useMemo(() => {
    switch (part.state) {
      case "input-available":
      case "input-streaming":
        if (streaming) return "streaming";
        return "error";
      case "output-available":
        if (
          isToolApprovalOutput(part.output) &&
          part.output.outcome === "pending"
        ) {
          return "pending-approval";
        }
        return "done";
      case "output-error":
        return "error";
    }
  }, [part, streaming]);

  const icon =
    state === "streaming" ? (
      <span
        style={{
          display: "inline-block",
          animation: "spin 1s linear infinite",
        }}
      >
        ⚙
      </span>
    ) : state === "pending-approval" ? (
      "⧗"
    ) : (
      "⚒"
    );
  const iconColor = state === "error" ? "#ef4444" : "#71717a";

  // Check if content exceeds max height
  React.useEffect(() => {
    if (contentRef.current) {
      const contentHeight = contentRef.current.scrollHeight;
      setNeedsExpand(contentHeight > 100);
    }
  }, [part.output, part.errorText, part.input]);

  return (
    <div
      style={{
        marginTop: "12px",
        marginBottom: "12px",
        padding: "12px",
        background: "var(--color-secondary)",
        borderRadius: "8px",
        border: "1px solid var(--color-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <span style={{ color: iconColor, fontWeight: "bold" }}>{icon}</span>
        <span
          style={{
            color: "var(--color-foreground)",
            fontSize: fontSizeMap[fontSize],
            fontWeight: 500,
          }}
        >
          {name}
        </span>
      </div>
      <div
        style={{
          position: "relative",
        }}
      >
        <div
          ref={contentRef}
          style={{
            marginLeft: "24px",
            fontSize: fontSizeMap[fontSize],
            maxHeight: isExpanded ? "none" : "100px",
            overflow: "hidden",
            position: "relative",
          }}
        >
          {/* Fade out gradient overlay */}
          {needsExpand && !isExpanded && (
            <div
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "60px",
                background:
                  "linear-gradient(to bottom, transparent, var(--color-secondary))",
                pointerEvents: "none",
              }}
            />
          )}
          <div
            style={{
              color: "var(--color-muted-foreground)",
              fontWeight: 600,
              marginBottom: "4px",
            }}
          >
            Input:
          </div>
          {Object.entries(part.input || {}).map(([key, value]) => (
            <div
              key={key}
              style={{
                marginLeft: "12px",
                marginBottom: "2px",
                wordBreak: "break-word",
                overflowWrap: "break-word",
              }}
            >
              <span style={{ color: "var(--color-muted-foreground)" }}>
                {key}
              </span>
              <span style={{ color: "var(--color-border)" }}>=</span>
              <span
                style={{
                  color: "var(--color-foreground)",
                  fontFamily:
                    "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
                }}
              >
                {JSON.stringify(value)}
              </span>
            </div>
          ))}
          {part.output && (
            <>
              <div
                style={{
                  color: "var(--color-muted-foreground)",
                  fontWeight: 600,
                  marginTop: "8px",
                  marginBottom: "4px",
                }}
              >
                Output:
              </div>
              <div
                style={{
                  marginLeft: "12px",
                  wordBreak: "break-word",
                  overflowWrap: "break-word",
                  whiteSpace: "pre-wrap",
                }}
              >
                <span
                  style={{
                    color: "var(--color-foreground)",
                    fontFamily:
                      "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
                  }}
                >
                  {typeof part.output === "string"
                    ? part.output
                    : JSON.stringify(part.output, null, 2)}
                </span>
              </div>
            </>
          )}
          {part.state === "output-error" && part.errorText && (
            <>
              <div
                style={{
                  color: "#fca5a5",
                  fontWeight: 600,
                  marginTop: "8px",
                  marginBottom: "4px",
                }}
              >
                Error:
              </div>
              <div
                style={{
                  color: "#fecaca",
                  marginLeft: "12px",
                  wordBreak: "break-word",
                  overflowWrap: "break-word",
                  whiteSpace: "pre-wrap",
                  backgroundColor: "rgba(127, 29, 29, 0.5)",
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid rgba(252, 165, 165, 0.3)",
                  fontFamily:
                    "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
                  fontSize: "12px",
                }}
              >
                {part.errorText}
              </div>
            </>
          )}
        </div>
      </div>
      {needsExpand && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            marginTop: "8px",
            width: "100%",
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 500,
            color: "var(--color-muted-foreground)",
            backgroundColor: "transparent",
            border: "1px solid rgba(128, 128, 128, 0.35)",
            borderRadius: "6px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-accent)";
            e.currentTarget.style.color = "var(--color-foreground)";
            e.currentTarget.style.border = "1px solid var(--color-border)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "var(--color-muted-foreground)";
            e.currentTarget.style.border =
              "1px solid rgba(128, 128, 128, 0.35)";
          }}
        >
          {isExpanded ? "Show less" : "Show more"}
        </button>
      )}
      {state === "pending-approval" && onApprove && onReject && (
        <>
          <div
            style={{
              marginTop: "16px",
              marginBottom: "12px",
              height: "1px",
              background: "var(--color-border)",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "8px",
            }}
          >
            <span
              style={{
                color: "var(--color-foreground)",
                fontSize: "12px",
                fontWeight: 700,
              }}
            >
              {autoApproveEnabled ? "Auto-approved" : "Tool approval required"}
            </span>
            {!autoApproveEnabled && (
              <>
                <button
                  onClick={() => onApprove && onApprove()}
                  autoFocus
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#10b981",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#059669";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#10b981";
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={() => onApprove && onApprove(true)}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#06b6d4",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#0891b2";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#06b6d4";
                  }}
                >
                  Auto
                </button>
                <button
                  onClick={onReject}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#dc2626";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "#ef4444";
                  }}
                >
                  Reject
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export const MessageBubble = ({
  message,
  streaming,
  showModeLabel = true,
  fontSize = "medium",
  onApprove,
  onReject,
  autoApproveEnabled,
  previousMessage,
}: {
  message: UIMessage;
  streaming: boolean;
  showModeLabel?: boolean;
  fontSize?: "small" | "medium" | "large";
  onApprove?: (autoApprove?: boolean) => void;
  onReject?: () => void;
  autoApproveEnabled?: boolean;
  previousMessage?: UIMessage;
}) => {
  const isUser = message.role === "user";
  const mode = (message as any).mode as "edit" | "run" | undefined;

  // Font size mapping
  const fontSizeMap = {
    small: "13px",
    medium: "15px",
    large: "17px",
  };

  const lineHeightMap = {
    small: "1.6",
    medium: "1.7",
    large: "1.8",
  };

  const bubbleStyle: React.CSSProperties = {
    maxWidth: "70%",
    background: isUser ? "var(--color-accent)" : "var(--color-card)",
    color: "var(--color-foreground)",
    padding: "12px 16px",
    borderRadius: "16px",
    borderTopRightRadius: isUser ? "4px" : "16px",
    borderTopLeftRadius: isUser ? "16px" : "4px",
    border: "1px solid var(--color-border)",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  };

  // Format timestamp
  const formatTimestamp = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Format TTFT (Time to First Token)
  const formatTTFT = (ttftMs: number | undefined) => {
    if (!ttftMs) return null;
    return `(${Math.round(ttftMs)}ms)`;
  };

  return (
    <div
      style={{
        marginBottom: "28px",
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
      }}
    >
      {showModeLabel && mode && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            paddingLeft: "0.5rem",
            paddingRight: "0.5rem",
            paddingTop: "0.125rem",
            paddingBottom: "0.125rem",
            borderRadius: "0.25rem",
            fontSize: "11px",
            fontWeight: 500,
            marginBottom: "4px",
            backgroundColor:
              mode === "edit"
                ? "rgba(234, 179, 8, 0.1)"
                : "rgba(59, 130, 246, 0.1)",
            color: mode === "edit" ? "#eab308" : "#60a5fa",
          }}
        >
          {mode === "edit" ? "Edit mode" : "Run mode"}
        </span>
      )}
      <div style={bubbleStyle}>
        {message.parts?.map((part, i) => {
          if (part.type === "text") {
            return (
              <div
                key={i}
                style={{
                  fontSize: fontSizeMap[fontSize],
                  lineHeight: lineHeightMap[fontSize],
                  color: "var(--color-foreground)",
                  fontFamily:
                    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif",
                  wordBreak: "break-word",
                }}
                className="markdown-content"
              >
                <ReactMarkdown
                  rehypePlugins={[rehypeHighlight]}
                  components={{
                    a: ({ node, href, children, ...props }) => {
                      const handleClick = (e: React.MouseEvent) => {
                        e.preventDefault();
                        if (href) {
                          try {
                            const { shell } = require("electron");
                            shell.openExternal(href);
                          } catch (err) {
                            console.error("Failed to open link:", err);
                          }
                        }
                      };
                      return (
                        <a
                          href={href}
                          onClick={handleClick}
                          style={{ cursor: "pointer" }}
                          {...props}
                        >
                          {children}
                        </a>
                      );
                    },
                  }}
                >
                  {part.text}
                </ReactMarkdown>
                {streaming && i === message.parts.length - 1 && (
                  <span
                    style={{
                      animation: "blink 1s step-end infinite",
                      color: "var(--color-muted-foreground)",
                      marginLeft: "2px",
                    }}
                  >
                    ▊
                  </span>
                )}
              </div>
            );
          }
          if (isToolOrDynamicToolUIPart(part)) {
            return (
              <ToolCallDisplay
                key={i}
                part={part}
                streaming={streaming}
                fontSize={fontSize}
                onApprove={onApprove}
                onReject={onReject}
                autoApproveEnabled={autoApproveEnabled}
              />
            );
          }
          return null;
        })}
      </div>
      <span
        style={{
          fontSize: "10px",
          color: "var(--color-muted-foreground)",
          opacity: 0.6,
          marginTop: "4px",
          paddingLeft: isUser ? "0" : "8px",
          paddingRight: isUser ? "8px" : "0",
        }}
      >
        {formatTimestamp((message as any).created_at)}
        {!isUser &&
          (message as any).metadata?.ttft &&
          (!previousMessage || previousMessage.role !== "assistant") && (
            <span style={{ marginLeft: "4px" }}>
              {formatTTFT((message as any).metadata.ttft)}
            </span>
          )}
      </span>
    </div>
  );
};
