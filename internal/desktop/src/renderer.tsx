import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useDevMode, Logger } from "blink/react";
import { useAuth } from "./hooks/useAuth";
import { existsSync } from "fs";
import { join } from "path";

// Declare electron API available via nodeIntegration
declare const require: any;
const { dialog } = require("electron").remote || require("@electron/remote");

function App() {
  const [directory, setDirectory] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState<string>("");
  const auth = useAuth();

  const selectDirectory = async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
        title: "Open Folder",
        buttonLabel: "Open",
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const selectedDir = result.filePaths[0];
        setDirectory(selectedDir);
        setError(null);
      }
    } catch (err) {
      setError(`Failed to select directory: ${err}`);
    }
  };

  // Show directory picker if no directory selected
  if (!directory) {
    return (
      <div style={styles.container}>
        <div style={styles.welcome}>
          <h1 style={styles.welcomeTitle}>🔗 Blink Desktop</h1>
          <p style={styles.welcomeText}>
            A desktop version of the Blink dev environment.
          </p>
          <button style={styles.primaryButton} onClick={selectDirectory}>
            📁 Open Folder
          </button>
          {error && <div style={styles.errorBox}>{error}</div>}
        </div>
      </div>
    );
  }

  const devMode = useDevMode({
    directory,
    onBuildStart: () => {
      setLogs((prev) => [...prev, "🔨 Build started..."]);
    },
    onBuildSuccess: (result) => {
      setLogs((prev) => [
        ...prev,
        `✅ Build succeeded in ${result.duration}ms`,
      ]);
    },
    onBuildError: (error) => {
      setLogs((prev) => [...prev, `❌ Build error: ${error.message}`]);
    },
    onEnvLoaded: (keys) => {
      setLogs((prev) => [
        ...prev,
        `🔑 Environment loaded (${keys.length} variables)`,
      ]);
    },
    onDevhookConnected: (url) => {
      setLogs((prev) => [...prev, `🌐 Devhook connected: ${url}`]);
    },
    onAgentLog: (log) => {
      setLogs((prev) => [...prev, `📝 ${log.message}`]);
    },
    onError: (error) => {
      setLogs((prev) => [...prev, `⚠️  ${error}`]);
    },
    onModeChange: (mode) => {
      setLogs((prev) => [...prev, `🔄 Mode changed to: ${mode}`]);
    },
    logger: new Logger(async (level, source, ...message) => {
      console[level](source, ...message);
    }),
  });

  const handleSubmit = async () => {
    if (!input.trim() || devMode.chat.status === "streaming") return;

    const message = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      role: "user" as const,
      parts: [{ type: "text" as const, text: input }],
      metadata: undefined,
      mode: devMode.mode,
    };

    setInput("");
    await devMode.chat.sendMessage(message);
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>🔗 Blink Desktop</h1>
        <div style={styles.statusBar}>
          <span style={styles.badge}>Mode: {devMode.mode}</span>
          <span style={styles.badge}>Build: {devMode.build.status}</span>
          {devMode.devhook.connected && (
            <span style={{ ...styles.badge, ...styles.badgeSuccess }}>
              🌐 Connected
            </span>
          )}
        </div>
      </header>

      <div style={styles.content}>
        {/* Left Sidebar - Chats */}
        <div style={styles.chatsSidebar}>
          <div style={styles.sidebarHeader}>
            <h3 style={styles.sidebarTitle}>Chats</h3>
            <button
              style={styles.iconButton}
              onClick={devMode.newChat}
              title="New Chat"
            >
              +
            </button>
          </div>
          <div style={styles.chatList}>
            {devMode.chats.map((chatId) => (
              <div
                key={chatId}
                style={{
                  ...styles.chatItem,
                  ...(devMode.chat.id === chatId ? styles.chatItemActive : {}),
                }}
                onClick={() => devMode.switchChat(chatId)}
              >
                <div style={styles.chatItemTitle}>
                  Chat {chatId.slice(0, 8)}
                </div>
                {chatId === devMode.chat.id && (
                  <div style={styles.chatItemMeta}>
                    {devMode.chat.messages.length} messages
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={styles.sidebarFooter}>
            <button
              style={styles.changeDirectoryButton}
              onClick={() => setDirectory(null)}
            >
              📁 Change Directory
            </button>
          </div>
        </div>

        <div style={styles.main}>
          <div style={styles.messagesContainer}>
            <h3 style={styles.sectionTitle}>Messages</h3>
            <div style={styles.messages}>
              {devMode.chat.messages.map((msg) => (
                <div key={msg.id} style={styles.message}>
                  <div style={styles.messageRole}>{msg.role}</div>
                  <div style={styles.messageContent}>
                    {msg.parts.map((part, i) => {
                      if (part.type === "text") {
                        return <div key={i}>{part.text}</div>;
                      }
                      if (part.type === "tool-call") {
                        return (
                          <div key={i} style={styles.toolCall}>
                            🔧 {(part as any).toolName || "tool"}
                          </div>
                        );
                      }
                      return <div key={i}>[{part.type}]</div>;
                    })}
                  </div>
                </div>
              ))}
              {devMode.chat.status === "streaming" && (
                <div style={styles.loading}>⏳ Loading...</div>
              )}
            </div>
          </div>

          <div style={styles.inputContainer}>
            <input
              type="text"
              style={styles.input}
              placeholder="Type a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              disabled={devMode.chat.status === "streaming"}
            />
            <button
              style={styles.sendButton}
              onClick={handleSubmit}
              disabled={devMode.chat.status === "streaming"}
            >
              Send
            </button>
          </div>

          {devMode.approval && (
            <div style={styles.approval}>
              <div style={styles.approvalContent}>
                <p>⚠️ Tool approval required</p>
                <div style={styles.approvalButtons}>
                  <button
                    style={{ ...styles.button, ...styles.buttonSuccess }}
                    onClick={() => devMode.approval?.approve()}
                  >
                    Approve
                  </button>
                  <button
                    style={{ ...styles.button, ...styles.buttonDanger }}
                    onClick={() => devMode.approval?.reject()}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar - Status & Logs */}
        <div style={styles.statusSidebar}>
          <div style={styles.statusSection}>
            <h3 style={styles.sectionTitle}>Status</h3>
            <div style={styles.statusGrid}>
              <div style={styles.statusCard}>
                <div style={styles.statusLabel}>Mode</div>
                <div style={styles.statusValue}>
                  {devMode.mode}
                  <button
                    style={styles.statusButton}
                    onClick={devMode.toggleMode}
                    title="Toggle mode"
                  >
                    ⇄
                  </button>
                </div>
              </div>
              <div style={styles.statusCard}>
                <div style={styles.statusLabel}>Build</div>
                <div
                  style={{
                    ...styles.statusValue,
                    color:
                      devMode.build.status === "success"
                        ? "#10b981"
                        : devMode.build.status === "error"
                          ? "#ef4444"
                          : "#a0a0a0",
                  }}
                >
                  {devMode.build.status}
                </div>
              </div>
              {devMode.devhook.connected && (
                <div style={styles.statusCard}>
                  <div style={styles.statusLabel}>Devhook</div>
                  <div style={{ ...styles.statusValue, color: "#10b981" }}>
                    connected
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={styles.statusSection}>
            <h3 style={styles.sectionTitle}>Auth</h3>
            {auth.status === "authenticated" && auth.email ? (
              <div style={styles.authInfo}>
                <div style={styles.authStatus}>✅ {auth.email}</div>
                <button style={styles.authButton} onClick={auth.logout}>
                  Sign Out
                </button>
              </div>
            ) : (
              <div style={styles.authInfo}>
                <div style={styles.authStatus}>⚪ Not signed in</div>
                <button style={styles.authButton} onClick={auth.login}>
                  Sign In
                </button>
              </div>
            )}
            {auth.status === "authenticating" && auth.authUrl && (
              <button style={styles.authButton} onClick={auth.openAuthUrl}>
                🌐 Open Browser
              </button>
            )}
          </div>

          <div style={styles.statusSection}>
            <h3 style={styles.sectionTitle}>Directory</h3>
            <div style={styles.pathDisplay}>{directory}</div>
            {devMode.build.entrypoint && (
              <div style={styles.pathDisplay}>
                Entry: {devMode.build.entrypoint}
              </div>
            )}
            {devMode.devhook.url && (
              <div style={styles.pathDisplay}>URL: {devMode.devhook.url}</div>
            )}
          </div>

          <div style={styles.statusSection}>
            <h3 style={styles.sectionTitle}>Logs</h3>
            <div style={styles.logs}>
              {logs.map((log, i) => (
                <div key={i} style={styles.logItem}>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    backgroundColor: "#1e1e1e",
    color: "#d4d4d4",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  welcome: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    gap: "24px",
    padding: "48px",
  },
  welcomeTitle: {
    fontSize: "48px",
    margin: 0,
    fontWeight: "700",
  },
  welcomeText: {
    fontSize: "18px",
    color: "#a0a0a0",
    margin: 0,
  },
  primaryButton: {
    padding: "16px 32px",
    fontSize: "16px",
    backgroundColor: "#0e7490",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "500",
    transition: "background-color 0.2s",
  },
  errorBox: {
    padding: "16px",
    backgroundColor: "#b91c1c",
    color: "#fff",
    borderRadius: "8px",
    maxWidth: "600px",
  },
  header: {
    padding: "16px 24px",
    borderBottom: "1px solid #333",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    margin: 0,
    fontSize: "20px",
    fontWeight: "600",
  },
  statusBar: {
    display: "flex",
    gap: "8px",
  },
  badge: {
    padding: "4px 12px",
    backgroundColor: "#333",
    borderRadius: "4px",
    fontSize: "12px",
  },
  badgeSuccess: {
    backgroundColor: "#0e7490",
  },
  content: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  chatsSidebar: {
    width: "280px",
    borderRight: "1px solid #333",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#252525",
  },
  sidebarHeader: {
    padding: "16px",
    borderBottom: "1px solid #333",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sidebarTitle: {
    margin: 0,
    fontSize: "14px",
    fontWeight: "600",
    color: "#a0a0a0",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  iconButton: {
    width: "32px",
    height: "32px",
    padding: 0,
    backgroundColor: "#333",
    color: "#d4d4d4",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  chatList: {
    flex: 1,
    overflowY: "auto",
  },
  chatItem: {
    padding: "12px 16px",
    cursor: "pointer",
    borderBottom: "1px solid #2a2a2a",
    transition: "background-color 0.2s",
  },
  chatItemActive: {
    backgroundColor: "#0e7490",
  },
  chatItemTitle: {
    fontSize: "14px",
    fontWeight: "500",
    marginBottom: "4px",
  },
  chatItemMeta: {
    fontSize: "12px",
    color: "#a0a0a0",
  },
  sidebarFooter: {
    padding: "16px",
    borderTop: "1px solid #333",
  },
  changeDirectoryButton: {
    width: "100%",
    padding: "8px 12px",
    backgroundColor: "#333",
    color: "#d4d4d4",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "13px",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    padding: "16px",
  },
  statusSidebar: {
    width: "320px",
    borderLeft: "1px solid #333",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#252525",
    overflowY: "auto",
  },
  statusSection: {
    padding: "16px",
    borderBottom: "1px solid #333",
  },
  sectionTitle: {
    margin: "0 0 12px 0",
    fontSize: "12px",
    fontWeight: "600",
    color: "#a0a0a0",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  statusGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
  },
  statusCard: {
    padding: "12px",
    backgroundColor: "#2a2a2a",
    borderRadius: "6px",
  },
  statusLabel: {
    fontSize: "11px",
    color: "#a0a0a0",
    marginBottom: "4px",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  statusValue: {
    fontSize: "14px",
    fontWeight: "600",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  statusButton: {
    padding: "4px 8px",
    backgroundColor: "#333",
    color: "#d4d4d4",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
  },
  pathDisplay: {
    padding: "8px",
    backgroundColor: "#2a2a2a",
    borderRadius: "4px",
    fontSize: "11px",
    fontFamily: "monospace",
    wordBreak: "break-all",
    marginBottom: "8px",
  },
  buttonSuccess: {
    backgroundColor: "#0e7490",
    borderColor: "#0e7490",
  },
  buttonDanger: {
    backgroundColor: "#b91c1c",
    borderColor: "#b91c1c",
  },
  messagesContainer: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "8px 0",
  },
  message: {
    marginBottom: "16px",
    padding: "12px",
    backgroundColor: "#2a2a2a",
    borderRadius: "6px",
  },
  messageRole: {
    fontWeight: "600",
    fontSize: "12px",
    marginBottom: "6px",
    color: "#0e7490",
    textTransform: "capitalize",
  },
  messageContent: {
    fontSize: "13px",
    lineHeight: "1.5",
  },
  toolCall: {
    padding: "6px 10px",
    backgroundColor: "#333",
    borderRadius: "4px",
    fontSize: "12px",
    marginTop: "6px",
    fontFamily: "monospace",
  },
  loading: {
    padding: "12px",
    textAlign: "center",
    color: "#a0a0a0",
    fontSize: "13px",
  },
  inputContainer: {
    display: "flex",
    gap: "8px",
    marginTop: "16px",
  },
  input: {
    flex: 1,
    padding: "10px 14px",
    backgroundColor: "#2a2a2a",
    color: "#d4d4d4",
    border: "1px solid #444",
    borderRadius: "4px",
    fontSize: "13px",
    outline: "none",
  },
  sendButton: {
    padding: "10px 24px",
    backgroundColor: "#0e7490",
    color: "#fff",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "500",
  },
  approval: {
    position: "fixed",
    bottom: "80px",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: "#2a2a2a",
    border: "1px solid #0e7490",
    borderRadius: "8px",
    padding: "16px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
  },
  approvalContent: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  approvalButtons: {
    display: "flex",
    gap: "8px",
  },
  logs: {
    fontSize: "11px",
    fontFamily: "monospace",
  },
  logItem: {
    padding: "4px 0",
    borderBottom: "1px solid #2a2a2a",
  },
  authInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  authStatus: {
    fontSize: "12px",
    color: "#d4d4d4",
    padding: "8px",
    backgroundColor: "#2a2a2a",
    borderRadius: "4px",
  },
  authButton: {
    padding: "8px 12px",
    backgroundColor: "#333",
    color: "#d4d4d4",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
    transition: "background-color 0.2s",
  },
};

// Initialize the React app
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
