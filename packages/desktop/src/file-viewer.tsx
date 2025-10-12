import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  vscDarkPlus,
  vs,
} from "react-syntax-highlighter/dist/esm/styles/prism";

declare const require: any;

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    php: "php",
    go: "go",
    rs: "rust",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    json: "json",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    graphql: "graphql",
  };
  return languageMap[ext] || "text";
}

function FileViewerWindow() {
  const { getCurrentWindow } = require("@electron/remote");
  const currentWindow = getCurrentWindow();
  const fileData = (currentWindow as any).fileData;

  // Load theme from localStorage
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [content, setContent] = useState<string>(fileData?.fileContent || "");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState<number>(0);
  const [totalMatches, setTotalMatches] = useState<number>(0);
  const [matchPositions, setMatchPositions] = useState<
    { line: number; col: number }[]
  >([]);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const contentContainerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem("blink-theme") as
      | "light"
      | "dark"
      | null;
    if (savedTheme) {
      setTheme(savedTheme);
    }
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // CMD+F or CTRL+F to open search
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 0);
      }
      // ESC to close search
      if (e.key === "Escape" && showSearch) {
        e.preventDefault();
        setShowSearch(false);
        setSearchQuery("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSearch]);

  // Listen for IPC messages to open search (from context menu)
  useEffect(() => {
    const { ipcRenderer } = require("electron");

    const handleOpenSearch = () => {
      setShowSearch(true);
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 0);
    };

    ipcRenderer.on("open-search", handleOpenSearch);

    return () => {
      ipcRenderer.removeListener("open-search", handleOpenSearch);
    };
  }, []);

  // Calculate matches when search query changes
  useEffect(() => {
    if (!searchQuery || !content) {
      setTotalMatches(0);
      setCurrentMatchIndex(0);
      setMatchPositions([]);
      return;
    }

    const regex = new RegExp(
      searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi"
    );
    const matches = content.match(regex);

    // Calculate line positions for each match
    const positions: { line: number; col: number }[] = [];
    const lines = content.split("\n");
    let totalIndex = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (!line) continue;
      const lineMatches = [...line.matchAll(regex)];

      for (const match of lineMatches) {
        positions.push({ line: lineIdx + 1, col: match.index || 0 });
      }
    }

    setMatchPositions(positions);
    setTotalMatches(matches ? matches.length : 0);
    setCurrentMatchIndex(matches && matches.length > 0 ? 1 : 0);
  }, [searchQuery, content]);

  // Scroll to current match
  useEffect(() => {
    if (currentMatchIndex === 0 || matchPositions.length === 0) return;

    const currentPosition = matchPositions[currentMatchIndex - 1];
    if (!currentPosition || !contentContainerRef.current) return;

    // Find the line element and scroll to it
    const lineElements = contentContainerRef.current.querySelectorAll(
      ".react-syntax-highlighter-line-number"
    );
    const targetLine = lineElements[currentPosition.line - 1] as HTMLElement;

    if (targetLine) {
      // Scroll to the line with some offset
      const container = contentContainerRef.current;
      const containerHeight = container.clientHeight;
      const lineTop = targetLine.offsetTop;
      const lineHeight = targetLine.offsetHeight;

      // Center the line in the viewport
      container.scrollTop = lineTop - containerHeight / 2 + lineHeight / 2;
    }
  }, [currentMatchIndex, matchPositions]);

  // Navigate to next match
  const goToNextMatch = () => {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((prev) => (prev >= totalMatches ? 1 : prev + 1));
  };

  // Navigate to previous match
  const goToPreviousMatch = () => {
    if (totalMatches === 0) return;
    setCurrentMatchIndex((prev) => (prev <= 1 ? totalMatches : prev - 1));
  };

  // Watch file for changes
  useEffect(() => {
    if (!fileData) return;

    const fs = require("fs");
    const path = require("path");
    const { filePath, fileContent, directory } = fileData;
    const fullPath = path.join(directory, filePath);

    // Set initial content
    setContent(fileContent);

    // Load content function
    const loadContent = () => {
      try {
        const newContent = fs.readFileSync(fullPath, "utf-8");
        setContent(newContent);
        console.log("[File Viewer] Reloaded file:", filePath);
      } catch (err) {
        console.error("[File Viewer] Failed to reload file:", err);
      }
    };

    // Watch for file changes
    let watcher: any;
    try {
      watcher = fs.watch(fullPath, (eventType: string) => {
        console.log("[File Viewer] File change detected:", eventType, filePath);
        if (eventType === "change") {
          loadContent();
        }
      });
      console.log("[File Viewer] Started watching:", fullPath);
    } catch (err) {
      console.error("[File Viewer] Failed to watch file:", err);
    }

    return () => {
      if (watcher) {
        watcher.close();
        console.log("[File Viewer] Stopped watching:", fullPath);
      }
    };
  }, [fileData]);

  if (!fileData) {
    return (
      <div
        className={`${theme} flex h-screen items-center justify-center bg-background text-foreground`}
      >
        <p>No file data available</p>
      </div>
    );
  }

  const { filePath, fileContent } = fileData;
  const language = getLanguageFromPath(filePath);

  // Highlight search matches in content
  const getHighlightedContent = () => {
    if (!searchQuery || !content) return content;

    const regex = new RegExp(
      searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi"
    );
    let matchCount = 0;

    return content.replace(regex, (match) => {
      matchCount++;
      const isCurrentMatch = matchCount === currentMatchIndex;
      // Use special markers that won't interfere with syntax highlighting
      return `⟦${isCurrentMatch ? "CURRENT" : "MATCH"}⟧${match}⟦END⟧`;
    });
  };

  const displayContent = searchQuery ? getHighlightedContent() : content;

  return (
    <div
      className={`${theme} flex h-screen flex-col bg-background text-foreground`}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
          backgroundColor: "var(--color-card)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: "var(--color-foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {filePath}
        </span>
        <button
          onClick={() => setShowSearch(!showSearch)}
          style={{
            padding: "4px 8px",
            fontSize: "11px",
            color: "var(--color-muted-foreground)",
            backgroundColor: "transparent",
            border: "1px solid var(--color-border)",
            borderRadius: "4px",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-accent)";
            e.currentTarget.style.color = "var(--color-foreground)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.color = "var(--color-muted-foreground)";
          }}
        >
          ⌘F Search
        </button>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div
          style={{
            padding: "8px 16px",
            borderBottom: "1px solid var(--color-border)",
            backgroundColor: "var(--color-card)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search in file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) {
                  goToPreviousMatch();
                } else {
                  goToNextMatch();
                }
              }
            }}
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: "12px",
              color: "var(--color-foreground)",
              backgroundColor: "var(--color-background)",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              outline: "none",
            }}
          />
          <div
            style={{
              fontSize: "11px",
              color: "var(--color-muted-foreground)",
              minWidth: "60px",
              textAlign: "center",
            }}
          >
            {totalMatches > 0
              ? `${currentMatchIndex}/${totalMatches}`
              : "No matches"}
          </div>
          <button
            onClick={goToPreviousMatch}
            disabled={totalMatches === 0}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              color:
                totalMatches === 0
                  ? "var(--color-muted-foreground)"
                  : "var(--color-foreground)",
              backgroundColor: "transparent",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              cursor: totalMatches === 0 ? "not-allowed" : "pointer",
              opacity: totalMatches === 0 ? 0.5 : 1,
            }}
          >
            ↑
          </button>
          <button
            onClick={goToNextMatch}
            disabled={totalMatches === 0}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              color:
                totalMatches === 0
                  ? "var(--color-muted-foreground)"
                  : "var(--color-foreground)",
              backgroundColor: "transparent",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              cursor: totalMatches === 0 ? "not-allowed" : "pointer",
              opacity: totalMatches === 0 ? 0.5 : 1,
            }}
          >
            ↓
          </button>
          <button
            onClick={() => {
              setShowSearch(false);
              setSearchQuery("");
            }}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              color: "var(--color-muted-foreground)",
              backgroundColor: "transparent",
              border: "1px solid var(--color-border)",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* File content */}
      <div
        ref={contentContainerRef}
        style={{
          flex: 1,
          overflow: "auto",
          backgroundColor: "var(--color-background)",
        }}
      >
        <SyntaxHighlighter
          language={language}
          style={theme === "light" ? vs : vscDarkPlus}
          showLineNumbers
          customStyle={{
            margin: 0,
            padding: "16px",
            fontSize: "13px",
            lineHeight: "1.6",
          }}
          wrapLines
          lineProps={(lineNumber) => {
            if (!searchQuery || matchPositions.length === 0) return {};

            // Check if this line contains the current match
            const currentPosition =
              currentMatchIndex > 0
                ? matchPositions[currentMatchIndex - 1]
                : null;
            const isCurrentMatchLine =
              currentPosition && currentPosition.line === lineNumber;

            // Check if this line contains any match
            const hasAnyMatch = matchPositions.some(
              (pos) => pos.line === lineNumber
            );

            if (isCurrentMatchLine) {
              return {
                style: {
                  backgroundColor:
                    theme === "light"
                      ? "rgba(255, 180, 0, 0.5)"
                      : "rgba(255, 180, 0, 0.35)",
                  transition: "background-color 0.2s ease",
                },
              };
            } else if (hasAnyMatch) {
              return {
                style: {
                  backgroundColor:
                    theme === "light"
                      ? "rgba(255, 237, 0, 0.25)"
                      : "rgba(255, 237, 0, 0.15)",
                },
              };
            }

            return {};
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<FileViewerWindow />);
}
