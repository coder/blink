"use client";

import type { AgentDeployment } from "@blink.so/api";
import Client from "@blink.so/api";
import { AlertCircle, File, Folder, FolderOpen } from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  vs,
  vscDarkPlus,
} from "react-syntax-highlighter/dist/esm/styles/prism";

interface FileNode {
  name: string;
  path: string;
  id: string;
  type: "file";
}

interface DirectoryNode {
  name: string;
  path: string;
  type: "directory";
  children: TreeNode[];
  expanded: boolean;
}

type TreeNode = FileNode | DirectoryNode;

// Build a file tree from flat list of files
function buildFileTree(files: Array<{ path: string; id: string }>): TreeNode[] {
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
          id: file.id,
          type: "file",
        });
      } else {
        let dir = currentLevel.find(
          (node) => node.type === "directory" && node.name === part
        ) as DirectoryNode | undefined;

        if (!dir) {
          dir = {
            name: part,
            path: currentPath,
            type: "directory",
            children: [],
            expanded: true, // Expand all by default
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
    pyw: "python",
    pyi: "python",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    go: "go",
    rs: "rust",
    c: "c",
    cpp: "cpp",
    cxx: "cpp",
    cc: "cpp",
    h: "c",
    hpp: "cpp",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    cs: "csharp",
    php: "php",
    rb: "ruby",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    sql: "sql",
    md: "markdown",
    mdx: "markdown",
    dockerfile: "dockerfile",
    txt: "text",
    log: "text",
  };

  return extensionMap[ext || ""] || "text";
}

// Find default file to select
function findDefaultFile(
  files: Array<{ path: string; id: string }>
): { path: string; id: string } | null {
  // Try README.md first
  const readme = files.find((f) => f.path.toLowerCase() === "readme.md");
  if (readme) return readme;

  // Try package.json
  const packageJson = files.find(
    (f) => f.path.toLowerCase() === "package.json"
  );
  if (packageJson) return packageJson;

  // Return first file or null
  return files[0] || null;
}

// Parse file parameter which can include line number (e.g., "path/to/file.ts:42")
function parseFileParam(fileParam: string): { path: string; line?: number } {
  const match = fileParam.match(/^(.+?)(?::(\d+))?$/);
  if (!match) return { path: fileParam };

  const [, path, lineStr] = match;
  const line = lineStr ? parseInt(lineStr, 10) : undefined;
  return { path, line };
}

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
  const isSelected = node.type === "file" && node.path === selectedPath;

  if (node.type === "file") {
    return (
      <button
        onClick={() => onSelect(node)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors ${
          isSelected
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground"
        }`}
        style={{ paddingLeft: `${level * 12 + 12}px` }}
      >
        <File className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => onToggle(node.path)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-muted-foreground"
        style={{ paddingLeft: `${level * 12 + 12}px` }}
      >
        {node.expanded ? (
          <FolderOpen className="w-4 h-4 flex-shrink-0" />
        ) : (
          <Folder className="w-4 h-4 flex-shrink-0" />
        )}
        <span className="truncate font-medium">{node.name}</span>
      </button>
      {node.expanded && (
        <div>
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
      )}
    </div>
  );
}

export default function AgentSource({
  deployment,
}: {
  deployment: AgentDeployment;
}) {
  const { resolvedTheme } = useTheme();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeContainerRef = useRef<HTMLDivElement>(null);

  const client = useMemo(() => new Client(), []);

  // Update URL when file or line changes (using pushState to avoid reload)
  const updateURL = (filePath: string, lineNumber?: number | null) => {
    const params = new URLSearchParams(searchParams.toString());

    if (lineNumber) {
      params.set("file", `${filePath}:${lineNumber}`);
    } else {
      params.set("file", filePath);
    }

    const newUrl = `${pathname}?${params.toString()}`;
    window.history.replaceState({ ...window.history.state }, "", newUrl);
  };

  // Initialize file tree and select file from URL or default
  useEffect(() => {
    if (!deployment.source_files || deployment.source_files.length === 0) {
      setFileTree([]);
      setSelectedFile(null);
      return;
    }

    const tree = buildFileTree(deployment.source_files);
    setFileTree(tree);

    // Check URL for file parameter
    const fileParam = searchParams.get("file");
    let fileToSelect: { path: string; id: string } | null = null;
    let lineToSelect: number | undefined;

    if (fileParam) {
      const { path, line } = parseFileParam(fileParam);
      fileToSelect =
        deployment.source_files.find((f) => f.path === path) || null;
      lineToSelect = line;
    }

    // Fall back to default file if URL param not found
    if (!fileToSelect) {
      fileToSelect = findDefaultFile(deployment.source_files);
    }

    if (fileToSelect) {
      setSelectedFile({
        name: fileToSelect.path.split("/").pop() || fileToSelect.path,
        path: fileToSelect.path,
        id: fileToSelect.id,
        type: "file",
      });
      setSelectedLine(lineToSelect || null);

      // Update URL if we're showing a default file and no file param exists
      if (!fileParam && fileToSelect) {
        updateURL(fileToSelect.path);
      }
    }
  }, [deployment.source_files, searchParams]);

  // Scroll to selected line when content loads
  useEffect(() => {
    if (selectedLine && fileContent && codeContainerRef.current) {
      // Wait for syntax highlighter to render
      setTimeout(() => {
        const lineElement = codeContainerRef.current?.querySelector(
          `[data-line-number="${selectedLine}"]`
        );
        if (lineElement) {
          lineElement.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
    }
  }, [selectedLine, fileContent]);

  // Delay showing loading state
  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }

    const timer = setTimeout(() => {
      setShowLoading(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [loading]);

  // Fetch file content when selection changes
  useEffect(() => {
    if (!selectedFile) {
      setFileContent(null);
      return;
    }

    // Clear content immediately to avoid showing old content with new syntax highlighting
    setFileContent(null);
    setLoading(true);
    setError(null);

    const fetchContent = async () => {
      try {
        const response = await client.request(
          "GET",
          `/api/files/${selectedFile.id}`
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }
        const text = await response.text();
        setFileContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
        setFileContent(null);
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [selectedFile, client]);

  const handleToggle = (path: string) => {
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

    setFileTree(toggleNode(fileTree));
  };

  const handleSelectFile = (node: FileNode) => {
    setSelectedFile(node);
    setSelectedLine(null);
    updateURL(node.path);
  };

  const handleLineClick = (lineNumber: number) => {
    if (!selectedFile) return;
    setSelectedLine(lineNumber);
    updateURL(selectedFile.path, lineNumber);
  };

  // Empty state
  if (!deployment.source_files || deployment.source_files.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm">No source files available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* File tree sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border overflow-y-auto scrollbar-transparent bg-muted/30">
        <div className="py-2">
          {fileTree.map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              level={0}
              selectedPath={selectedFile?.path || null}
              onSelect={handleSelectFile}
              onToggle={handleToggle}
            />
          ))}
        </div>
      </div>

      {/* Code viewer */}
      <div className="flex-1 w-0 overflow-hidden flex flex-col">
        {selectedFile && (
          <>
            {/* File header */}
            <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex-shrink-0 w-full">
              <div className="flex items-center gap-2 min-w-0 max-w-full">
                <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium truncate">
                  {selectedFile.path}
                  {selectedLine && (
                    <span className="text-muted-foreground">
                      :{selectedLine}
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* File content */}
            <div className="flex-1 w-full overflow-hidden">
              {showLoading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground animate-in fade-in duration-300">
                  <p className="text-sm">Loading...</p>
                </div>
              ) : error ? (
                <div className="flex items-center justify-center h-full text-destructive">
                  <div className="text-center">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2" />
                    <p className="text-sm">{error}</p>
                  </div>
                </div>
              ) : fileContent !== null ? (
                <div
                  ref={codeContainerRef}
                  className="w-full h-full overflow-auto scrollbar-transparent"
                >
                  <SyntaxHighlighter
                    language={getLanguageFromExtension(selectedFile.path)}
                    showLineNumbers={true}
                    wrapLongLines={true}
                    style={resolvedTheme === "dark" ? vscDarkPlus : vs}
                    customStyle={{
                      background: "transparent",
                      margin: 0,
                      padding: "1rem",
                      fontSize: "14px",
                    }}
                    codeTagProps={{
                      style: {
                        fontFamily: "var(--font-geist-mono)",
                      },
                    }}
                    lineNumberContainerProps={{
                      style: {
                        cursor: "pointer",
                        userSelect: "none",
                      },
                    }}
                    lineNumberStyle={(lineNumber) => ({
                      cursor: "pointer",
                      userSelect: "none",
                      backgroundColor:
                        selectedLine === lineNumber
                          ? "rgba(59, 130, 246, 0.1)"
                          : "transparent",
                      display: "inline-block",
                      paddingRight: "1em",
                    })}
                    lineProps={(lineNumber) => ({
                      style: {
                        backgroundColor:
                          selectedLine === lineNumber
                            ? "rgba(59, 130, 246, 0.1)"
                            : "transparent",
                      },
                      "data-line-number": lineNumber,
                      onClick: () => handleLineClick(lineNumber),
                    })}
                  >
                    {fileContent}
                  </SyntaxHighlighter>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
