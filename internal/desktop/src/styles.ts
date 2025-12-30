import React from "react";

// Extend CSSProperties to include Electron-specific properties
interface ElectronCSSProperties extends React.CSSProperties {
  WebkitAppRegion?: "drag" | "no-drag";
}

export const styles: Record<string, ElectronCSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    backgroundColor: "#09090b",
    color: "#e4e4e7",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Code', 'Droid Sans', 'Helvetica Neue', sans-serif",
  },
  header: {
    padding: "12px 20px",
    borderBottom: "1px solid #27272a",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#09090b",
    WebkitAppRegion: "drag",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    paddingLeft: "60px",
  },
  headerCenter: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    WebkitAppRegion: "no-drag",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    WebkitAppRegion: "no-drag",
  },
  title: {
    margin: 0,
    fontSize: "18px",
    fontWeight: "600",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: "14px",
    color: "#71717a",
    fontWeight: "400",
  },
  modeButton: {
    padding: "6px 16px",
    borderRadius: "6px",
    border: "none",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  connectedBadge: {
    fontSize: "12px",
    color: "#10b981",
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  headerButton: {
    padding: "6px 12px",
    background: "#18181b",
    color: "#e4e4e7",
    border: "1px solid #27272a",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "500",
    transition: "all 0.2s ease",
  },
  deployButton: {
    padding: "6px 16px",
    background: "#3b82f6",
    color: "#ffffff",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "600",
    transition: "all 0.2s ease",
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  deployStatus: {
    padding: "12px 20px",
    background: "#18181b",
    borderBottom: "1px solid #27272a",
    fontSize: "13px",
    color: "#e4e4e7",
    fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
  },
  content: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  chatsSidebar: {
    width: "240px",
    minWidth: "240px",
    borderRight: "1px solid #27272a",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#09090b",
    overflowY: "auto",
  },
  sidebarHeader: {
    padding: "16px",
    borderBottom: "1px solid #27272a",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sidebarTitle: {
    margin: 0,
    fontSize: "12px",
    fontWeight: "600",
    color: "#71717a",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  iconButton: {
    width: "28px",
    height: "28px",
    padding: 0,
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    border: "1px solid #27272a",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s ease",
  },
  chatList: {
    maxHeight: "300px",
    overflowY: "auto",
  },
  chatItem: {
    padding: "12px 16px",
    cursor: "pointer",
    borderBottom: "1px solid #18181b",
    transition: "background-color 0.15s ease",
  },
  chatItemActive: {
    backgroundColor: "#27272a",
  },
  chatItemTitle: {
    fontSize: "13px",
    fontWeight: "500",
    marginBottom: "4px",
    color: "#e4e4e7",
  },
  chatItemMeta: {
    fontSize: "12px",
    color: "#71717a",
  },
  main: {
    flex: "0 0 500px",
    display: "flex",
    flexDirection: "column",
    padding: "20px",
    minWidth: 0,
    overflow: "hidden",
  },

  statusSection: {
    padding: "16px",
    borderBottom: "1px solid #27272a",
  },
  sectionTitle: {
    margin: "0 0 12px 0",
    fontSize: "12px",
    fontWeight: "600",
    color: "#71717a",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  infoGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  infoItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    background: "#18181b",
    borderRadius: "6px",
    border: "1px solid #27272a",
  },
  infoLabel: {
    fontSize: "12px",
    color: "#a1a1aa",
    fontWeight: "500",
  },
  infoValue: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#e4e4e7",
  },
  pathDisplay: {
    padding: "8px 12px",
    backgroundColor: "#18181b",
    borderRadius: "6px",
    border: "1px solid #27272a",
    fontSize: "12px",
    fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
    wordBreak: "break-all",
    marginBottom: "8px",
    color: "#a1a1aa",
  },
  messagesContainer: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minHeight: 0,
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 0",
    minHeight: 0,
  },
  waitingPlaceholder: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    marginBottom: "24px",
    padding: "4px 0",
  },
  streamingSpinner: {
    animation: "spin 1s linear infinite",
    color: "#71717a",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    padding: "40px",
    textAlign: "center",
  },
  emptyStateIcon: {
    fontSize: "64px",
    marginBottom: "16px",
    opacity: 0.3,
  },
  emptyStateText: {
    fontSize: "16px",
    fontWeight: "600",
    color: "#71717a",
    marginBottom: "8px",
  },
  emptyStateSubtext: {
    fontSize: "14px",
    color: "#52525b",
  },
  inputContainer: {
    display: "flex",
    gap: "8px",
    marginTop: "16px",
    marginBottom: "12px",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 0 0",
    borderTop: "1px solid #27272a",
    fontSize: "12px",
    marginTop: "8px",
  },
  footerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  footerRight: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },
  footerHint: {
    color: "#52525b",
    fontSize: "11px",
  },
  input: {
    flex: 1,
    padding: "12px 16px",
    backgroundColor: "#18181b",
    color: "#e4e4e7",
    border: "1px solid #27272a",
    borderRadius: "8px",
    fontSize: "14px",
    outline: "none",
    transition: "all 0.2s ease",
    fontFamily: "inherit",
  },
  sendButton: {
    padding: "12px 28px",
    backgroundColor: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: "600",
    transition: "all 0.2s ease",
    boxShadow: "0 1px 3px rgba(59, 130, 246, 0.3)",
  },
  approval: {
    position: "fixed",
    bottom: "100px",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: "#18181b",
    border: "1px solid #3b82f6",
    borderRadius: "8px",
    padding: "16px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
    zIndex: 1000,
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
  button: {
    padding: "8px 16px",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "600",
    transition: "all 0.2s ease",
  },
  buttonSuccess: {
    backgroundColor: "#10b981",
    color: "#ffffff",
  },
  buttonDanger: {
    backgroundColor: "#ef4444",
    color: "#ffffff",
  },
  logs: {
    fontSize: "11px",
    fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
    color: "#a1a1aa",
  },
  logItem: {
    padding: "4px 0",
    borderBottom: "1px solid #18181b",
  },
};

// Global CSS for markdown and animations
export const globalStyles = `
  @keyframes blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.8; }
  }
  
  input:focus {
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
  }
  
  button:hover:not(:disabled) {
    filter: brightness(1.1);
    transform: translateY(-1px);
  }
  
  button:active:not(:disabled) {
    transform: translateY(0);
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  /* Custom scrollbar */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  ::-webkit-scrollbar-track {
    background: #09090b;
  }
  
  ::-webkit-scrollbar-thumb {
    background: #27272a;
    border-radius: 4px;
  }
  
  ::-webkit-scrollbar-thumb:hover {
    background: #3f3f46;
  }
  
  /* Markdown styling */
  .markdown-content {
    line-height: 1.7;
  }
  
  .markdown-content code {
    background: #18181b;
    padding: 3px 6px;
    border-radius: 4px;
    fontSize: 0.9em;
    color: #c084fc;
    fontFamily: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
  }
  
  .markdown-content pre {
    background: #18181b;
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    border: 1px solid #27272a;
    margin: 16px 0;
  }
  
  .markdown-content pre code {
    background: transparent;
    padding: 0;
    color: #e4e4e7;
  }
  
  .markdown-content a {
    color: #60a5fa;
    text-decoration: none;
  }
  
  .markdown-content a:hover {
    text-decoration: underline;
  }
  
  .markdown-content blockquote {
    border-left: 3px solid #3f3f46;
    padding-left: 16px;
    margin: 16px 0;
    color: #a1a1aa;
    font-style: italic;
  }
  
  .markdown-content ul, .markdown-content ol {
    padding-left: 24px;
    margin: 12px 0;
  }
  
  .markdown-content li {
    margin: 6px 0;
  }
  
  .markdown-content h1, .markdown-content h2, .markdown-content h3 {
    margin-top: 24px;
    margin-bottom: 12px;
    font-weight: 600;
    color: #f4f4f5;
    line-height: 1.3;
  }
  
  .markdown-content h1 { font-size: 1.875em; margin-top: 0; }
  .markdown-content h2 { font-size: 1.5em; }
  .markdown-content h3 { font-size: 1.25em; }
  
  .markdown-content p {
    margin: 0 0 16px 0;
  }
  
  .markdown-content p:last-child {
    margin-bottom: 0;
  }
  
  .markdown-content strong {
    font-weight: 600;
    color: #fafafa;
  }
  
  /* Syntax highlighting */
  .hljs {
    background: #18181b !important;
    color: #e4e4e7 !important;
  }
`;
