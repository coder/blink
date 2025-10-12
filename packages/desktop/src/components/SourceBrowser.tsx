import React, { useState, useMemo, memo, useEffect } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  vscDarkPlus,
  vs,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { ExternalLink, ChevronDown, ChevronRight, File, X } from "lucide-react";
import { useTheme } from "../contexts/ThemeContext";

declare const require: any;

export interface FileNode {
  name: string;
  path: string;
  type: "file";
}

export interface DirectoryNode {
  name: string;
  path: string;
  type: "directory";
  children: TreeNode[];
  expanded: boolean;
}

export type TreeNode = FileNode | DirectoryNode;

// Helper to find a directory node by path in the tree
function findDirectoryInTree(
  tree: TreeNode[],
  targetPath: string
): DirectoryNode | undefined {
  for (const node of tree) {
    if (node.type === "directory" && node.path === targetPath) {
      return node;
    }
    if (node.type === "directory") {
      const found = findDirectoryInTree(node.children, targetPath);
      if (found) return found;
    }
  }
  return undefined;
}

// Build a file tree from flat list of files
export function buildFileTree(
  files: Array<{ name: string; path: string }>,
  previousTree?: TreeNode[]
): TreeNode[] {
  const root: DirectoryNode[] = [];

  files.forEach((file) => {
    const parts = file.path.split("/").filter(Boolean);
    let currentLevel: TreeNode[] = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const currentPath = parts.slice(0, index + 1).join("/");

      if (isFile) {
        currentLevel.push({
          name: part,
          path: currentPath,
          type: "file",
        });
      } else {
        let dir = currentLevel.find(
          (node) => node.type === "directory" && node.name === part
        ) as DirectoryNode | undefined;

        if (!dir) {
          // Check if this directory existed in the previous tree to preserve expansion state
          let wasExpanded = false; // Default NEW directories to collapsed
          if (previousTree) {
            const previousDir = findDirectoryInTree(previousTree, currentPath);
            if (previousDir) {
              // Directory existed before, use its previous state
              wasExpanded = previousDir.expanded;
            }
            // If directory is new (previousDir is undefined), keep wasExpanded = false
          } else {
            // No previous tree means this is the first load - expand all directories
            wasExpanded = true;
          }

          dir = {
            name: part,
            path: currentPath,
            type: "directory",
            children: [],
            expanded: wasExpanded,
          };
          currentLevel.push(dir);
        }

        currentLevel = dir.children;
      }
    });
  });

  return root;
}

// Get language from file extension
function getLanguageFromExtension(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();

  const extensionMap: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    html: "html",
    css: "css",
    md: "markdown",
    txt: "text",
  };

  return extensionMap[ext || ""] || "text";
}

// Memoized code viewer to prevent re-renders
const CodeViewer = memo(
  ({
    content,
    filePath,
    theme,
  }: {
    content: string;
    filePath: string;
    theme: "light" | "dark";
  }) => {
    return (
      <SyntaxHighlighter
        language={getLanguageFromExtension(filePath)}
        showLineNumbers={true}
        wrapLongLines={false}
        style={theme === "light" ? vs : vscDarkPlus}
        customStyle={{
          margin: 0,
          padding: "16px",
          fontSize: "13px",
          lineHeight: "1.6",
        }}
        codeTagProps={{
          style: {
            fontFamily:
              "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
          },
        }}
      >
        {content}
      </SyntaxHighlighter>
    );
  }
);

interface FileTreeItemProps {
  node: TreeNode;
  level: number;
  selectedPath: string | null;
  onSelect: (node: FileNode) => void;
  onToggle: (path: string) => void;
}

function FileTreeItem({
  node,
  level,
  selectedPath,
  onSelect,
  onToggle,
}: FileTreeItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isSelected = node.type === "file" && node.path === selectedPath;

  if (node.type === "file") {
    return (
      <button
        onClick={() => onSelect(node)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          padding: "6px 12px",
          paddingLeft: `${level * 16 + 12}px`,
          fontSize: "13px",
          backgroundColor: isSelected
            ? "var(--color-accent)"
            : isHovered
              ? "var(--color-accent)"
              : "transparent",
          color: "var(--color-foreground)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          transition: "background 0.15s ease",
        }}
      >
        <File style={{ width: "16px", height: "16px", flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
          {node.name}
        </span>
        {isHovered && (
          <ExternalLink
            style={{
              width: "14px",
              height: "14px",
              flexShrink: 0,
              opacity: 0.6,
            }}
          />
        )}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => onToggle(node.path)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px 12px",
          paddingLeft: `${level * 16 + 12}px`,
          fontSize: "13px",
          backgroundColor: isHovered ? "var(--color-accent)" : "transparent",
          color: "var(--color-muted-foreground)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontWeight: 500,
          transition: "background 0.15s ease",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          style={{
            width: "16px",
            height: "16px",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "transform 0.35s ease",
            transitionDelay: node.expanded ? "0s" : "0.25s",
            transform: node.expanded ? "rotate(0deg)" : "rotate(-90deg)",
          }}
        >
          <ChevronDown style={{ width: "16px", height: "16px" }} />
        </div>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {node.name}
        </span>
      </button>
      <div
        style={{
          maxHeight: node.expanded ? "10000px" : "0",
          overflow: "hidden",
          transition: node.expanded
            ? "max-height 0.3s ease"
            : "max-height 0.25s ease",
        }}
      >
        {node.children.map((child) => (
          <FileTreeItem
            key={child.path}
            node={child}
            level={level + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

export default function SourceBrowser({
  fileTree,
  selectedFile,
  onSelectFile,
  fileContent,
  directory,
  blinkVersion,
  onClose,
  onToggleDirectory,
}: {
  fileTree: TreeNode[];
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  fileContent: string | null;
  directory: string;
  blinkVersion: string | null;
  onClose?: () => void;
  onToggleDirectory?: (path: string) => void;
}) {
  const { theme } = useTheme();
  const [fileTreeHeight, setFileTreeHeight] = useState(50); // percentage
  const [isResizingDivider, setIsResizingDivider] = useState(false);
  const startYRef = React.useRef<number>(0);
  const startHeightRef = React.useRef<number>(50);

  const handleToggle = (path: string) => {
    if (onToggleDirectory) {
      onToggleDirectory(path);
    }
  };

  const handleSelectFile = async (node: FileNode) => {
    const { ipcRenderer } = require("electron");
    const fs = require("fs");
    const path = require("path");

    try {
      const fullPath = path.join(directory, node.path);
      const fileContent = fs.readFileSync(fullPath, "utf-8");

      await ipcRenderer.invoke("open-file-viewer", {
        filePath: node.path,
        fileContent: fileContent,
        directory: directory,
      });
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  };

  const projectName = directory.split("/").pop() || directory;

  // Mock tools data - replace with real implementation later
  const tools = [
    {
      name: "execute_bash",
      description:
        "Execute bash commands in the terminal. Use this to run scripts, check file contents, or perform system operations.",
    },
    {
      name: "read_file",
      description:
        "Read the contents of a file from the filesystem. Supports text files, code files, and configuration files.",
    },
    {
      name: "write_file",
      description:
        "Write content to a file on the filesystem. Creates new files or overwrites existing ones.",
    },
  ];

  const handleOpenInFinder = () => {
    const { shell } = require("electron");
    shell.openPath(directory);
  };

  // Handle divider resize
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isResizingDivider) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const deltaY = event.clientY - startYRef.current;
      const deltaPercentage = (deltaY / rect.height) * 100;
      const newPercentage = startHeightRef.current + deltaPercentage;

      // Clamp between 20% and 80%
      const clampedPercentage = Math.min(Math.max(newPercentage, 20), 80);
      setFileTreeHeight(clampedPercentage);
    };

    const handleMouseUp = () => {
      setIsResizingDivider(false);
      document.body.style.cursor = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "row-resize";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
    };
  }, [isResizingDivider]);

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
      }}
    >
      {/* Project name header */}
      <div
        style={{
          padding: "16px 16px 0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <h2
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--color-foreground)",
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={directory}
        >
          {projectName}
        </h2>
        <button
          onClick={onClose}
          style={{
            padding: "6px",
            backgroundColor: "transparent",
            border: "1px solid var(--color-border)",
            borderRadius: "4px",
            color: "var(--color-muted-foreground)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--color-accent)";
            e.currentTarget.style.borderColor = "var(--color-border)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "transparent";
            e.currentTarget.style.borderColor = "var(--color-border)";
          }}
          title="Close"
        >
          <X style={{ width: "16px", height: "16px" }} />
        </button>
      </div>

      {/* Blink version info */}
      {blinkVersion && (
        <div
          style={{
            padding: "4px 16px 9px 16px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "var(--color-muted-foreground)",
            }}
          >
            This agent uses Blink v{blinkVersion}
          </div>
        </div>
      )}

      {/* File tree sidebar */}
      <div
        style={{
          width: "100%",
          overflowY: "auto",
          flex: 1,
          flexShrink: 0,
        }}
      >
        <div style={{ paddingTop: "8px", paddingBottom: "8px" }}>
          {fileTree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              level={0}
              selectedPath={selectedFile}
              onSelect={handleSelectFile}
              onToggle={handleToggle}
            />
          ))}
        </div>
      </div>

      {/* Resizable divider */}
      <div
        style={{
          height: "8px",
          width: "100%",
          cursor: "row-resize",
          backgroundColor: isResizingDivider
            ? "var(--color-accent)"
            : "transparent",
          borderTop: "1px solid var(--color-border)",
          borderBottom: "1px solid var(--color-border)",
          display: "none", // Hidden for now
          alignItems: "center",
          justifyContent: "center",
          transition: "background-color 0.15s ease",
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          startYRef.current = e.clientY;
          startHeightRef.current = fileTreeHeight;
          setIsResizingDivider(true);
        }}
        onMouseEnter={(e) => {
          if (!isResizingDivider) {
            e.currentTarget.style.backgroundColor = "var(--color-accent)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isResizingDivider) {
            e.currentTarget.style.backgroundColor = "transparent";
          }
        }}
      >
        <div
          style={{
            width: "32px",
            height: "3px",
            borderRadius: "2px",
            backgroundColor: "var(--color-border)",
          }}
        />
      </div>

      {/* Tools section */}
      <div
        style={{
          width: "100%",
          height: `${100 - fileTreeHeight}%`,
          flexShrink: 0,
          display: "none", // Hidden for now
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <h3
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "var(--color-foreground)",
              margin: 0,
            }}
          >
            Agent Tools
          </h3>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 0",
          }}
        >
          {tools.length === 0 ? (
            <div
              style={{
                padding: "16px",
                textAlign: "center",
                color: "var(--color-muted-foreground)",
                fontSize: "12px",
              }}
            >
              No tools found
            </div>
          ) : (
            tools.map((tool, index) => (
              <div
                key={index}
                style={{
                  padding: "10px 16px",
                  borderBottom:
                    index < tools.length - 1
                      ? "1px solid var(--color-border)"
                      : "none",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--font-mono)",
                    marginBottom: tool.description ? "4px" : "0",
                  }}
                >
                  {tool.name}
                </div>
                {tool.description && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-muted-foreground)",
                      lineHeight: "1.4",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {tool.description}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
