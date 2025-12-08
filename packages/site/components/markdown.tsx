import type { Root as HastRoot } from "hast";
import { useTheme } from "next-themes";
import React, { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
  vs,
  vscDarkPlus,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

import mermaid from "mermaid";
import { CheckCircleFillIcon, CopyIcon } from "./icons";
import { Button } from "./ui/button";

const citationClasses =
  "text-[10px] no-underline hover:underline bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-400 py-0.5 px-2 rounded-xl break-all select-none";

const components: Partial<Components> & {
  shortcut?: (args: { name: string; content: string }) => React.ReactNode;
} = {
  shortcut: ({ name, content }: { name: string; content: string }) => {
    return (
      <span className="text-xs no-underline bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-400 py-0.5 px-2 rounded-xl select-none">
        @{name}
      </span>
    );
  },
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || "");
    const { resolvedTheme } = useTheme();

    if (match && match[1] === "mermaid") {
      const ref = useRef<HTMLDivElement>(null);

      useEffect(() => {
        let cancelled = false;
        const id = crypto.randomUUID().replace(/-/g, "");

        const initializeAndRender = async () => {
          if (!ref.current || !children || cancelled) {
            return;
          }

          try {
            // Initialize mermaid with current theme
            await mermaid.initialize({
              theme: resolvedTheme === "dark" ? "dark" : "default",
              startOnLoad: false,
            });

            // Small delay to ensure DOM is ready
            await new Promise((resolve) => setTimeout(resolve, 10));

            if (cancelled || !ref.current) {
              return;
            }

            // Clear any existing content
            ref.current.innerHTML = "";
            ref.current.id = id;

            // Render the diagram
            const result = await mermaid.render(
              `mermaid-${id}`,
              String(children)
            );

            if (!cancelled && ref.current) {
              ref.current.innerHTML = result.svg;
              result.bindFunctions?.(ref.current);
            }
          } catch (error) {
            document.getElementById(`mermaid-${id}`)?.remove();
          }
        };

        initializeAndRender();

        return () => {
          cancelled = true;
          if (ref.current) {
            ref.current.innerHTML = "";
          }
        };
      }, [children, resolvedTheme]);

      return <div className="my-4 text-center" ref={ref} />;
    }

    return match ? (
      <SyntaxHighlighter
        {...props}
        ref={null}
        PreTag="div"
        children={String(children).replace(/\n$/, "")}
        language={match[1]}
        wrapLongLines={false}
        customStyle={{
          background: "transparent",
          padding: 0,
          margin: 0,
          border: 0,
          outline: 0,
          boxShadow: "none",
          fontSize: "16px",
          whiteSpace: "pre",
          overflowX: "auto",
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-geist-mono)",
            whiteSpace: "pre",
            wordBreak: "normal",
            overflowX: "auto",
          },
        }}
        style={resolvedTheme === "light" ? vs : vscDarkPlus}
      />
    ) : (
      <code
        className="text-sm font-mono font-normal in-[pre]:bg-transparent! in-[pre]:text-inherit bg-stone-200 dark:bg-orange-950/60 text-black dark:text-orange-300 py-0.5 px-1 rounded-md break-all"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
      // Extract text content from children
      const getTextContent = (node: any): string => {
        if (typeof node === "string") return node;
        if (Array.isArray(node)) return node.map(getTextContent).join("");
        if (node?.props?.children) return getTextContent(node.props.children);
        return "";
      };

      const textContent = getTextContent(children);

      try {
        await navigator.clipboard.writeText(textContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      } catch (err) {
        console.error("Failed to copy text: ", err);
      }
    };

    return (
      <div className="relative group">
        <pre
          className="text-sm bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 p-4 rounded-lg overflow-x-auto font-mono my-3 max-w-full"
          {...props}
        >
          {children}
        </pre>
        <Button
          variant="ghost"
          size="sm"
          className={`absolute bottom-3 right-0 h-7 w-7 p-0 text-xs transition-all duration-200 rounded-tl-none rounded-tr-none rounded-bl-none rounded-br-md flex items-center justify-center ${
            copied
              ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
              : "bg-neutral-200/80 dark:bg-neutral-800/80 hover:bg-neutral-300 dark:hover:bg-neutral-700 backdrop-blur-sm text-neutral-600 dark:text-neutral-400"
          }`}
          onClick={handleCopy}
          title={copied ? "Copied!" : "Copy to clipboard"}
        >
          {copied ? <CheckCircleFillIcon size={12} /> : <CopyIcon size={12} />}
        </Button>
      </div>
    );
  },
  hr: ({ ...props }) => (
    <hr
      className="my-4 border-0 h-px bg-stone-200 dark:bg-stone-700"
      {...props}
    />
  ),
  img: ({ src, alt, width, height, ...props }) => {
    if (!src || typeof src !== "string") return null;

    return (
      <img
        src={src}
        alt={alt || ""}
        width={width ? Number(width) : undefined}
        height={height ? Number(height) : undefined}
        className="max-w-full h-auto rounded-lg my-2"
      />
    );
  },
  table: ({ children, ...props }) => (
    <div className="overflow-x-auto my-4">
      <table
        className="min-w-full border-collapse border border-stone-200 dark:border-stone-700"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-stone-50 dark:bg-stone-800" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => <tbody {...props}>{children}</tbody>,
  tr: ({ children, ...props }) => (
    <tr className="border-b border-stone-200 dark:border-stone-700" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th
      className="px-4 py-2 text-left font-semibold border-r border-stone-200 dark:border-stone-700 last:border-r-0"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      className="px-4 py-2 border-r border-stone-200 dark:border-stone-700 last:border-r-0 align-top"
      {...props}
    >
      {children}
    </td>
  ),
  ol: ({ children, ...props }) => (
    <ol className="list-decimal list-outside ml-4 my-1" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="py-0 mt-0.5 mb-0.5" {...props}>
      {children}
    </li>
  ),
  ul: ({ children, ...props }) => (
    <ul className="list-disc list-outside ml-2 mt-0.5 mb-0.5" {...props}>
      {children}
    </ul>
  ),
  p: ({ children, ...props }) => (
    <p className="my-1 whitespace-pre-wrap" {...props}>
      {children}
    </p>
  ),
  strong: ({ children, ...props }) => (
    <span className="font-semibold" {...props}>
      {children}
    </span>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 no-underline hover:underline"
      target="_blank"
      rel="noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  h1: ({ children, ...props }) => (
    <h1 className="text-xl font-semibold mt-2 mb-1 first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="text-lg font-semibold mt-2 mb-1" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="text-base font-semibold mt-2 mb-1" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="text-sm font-semibold mt-2 mb-1" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5 className="text-sm font-semibold mt-2 mb-1" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6 className="text-xs font-semibold mt-2 mb-1" {...props}>
      {children}
    </h6>
  ),
};

export const preprocessText = (text: string, role?: string) => {
  // Hide incomplete streaming tags: <blink-citation ... or <blink-shortcut ... (no closing >)
  let out = text
    .replace(/<blink-citation[^>]*$/gi, "")
    .replace(/<blink-shortcut[^>]*$/gi, "");

  // Only apply WYSIWYG escaping for user messages
  if (role === "user") {
    // Escape triple backticks FIRST to prevent them from being treated as fence boundaries
    out = out.replace(/```/g, "´´´");

    // WYSIWYG approach: escape all markup outside fences for literal display
    const lines = out.split("\n");
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i] ?? "";

      // Track fence boundaries (now using escaped backticks won't trigger this)
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        continue;
      }

      // Skip processing inside fences - let syntax highlighter handle it
      if (inFence) continue;

      // Preserve all leading spaces/tabs with NBSP so they survive Markdown parsing
      if (/^[ \t]+/.test(line)) {
        line = line.replace(/^[ \t]+/, (m) =>
          m.replace(/ /g, "\u00A0").replace(/\t/g, "\u00A0\u00A0\u00A0\u00A0")
        );
      }

      // Escape HTML/XML tags for literal display (preserve blink tags)
      line = line
        // Escape HTML tags (except blink tags)
        .replace(/<(?!\/?(?:blink-citation|blink-shortcut)\b)[^>]*>/g, (m) =>
          m.replace(/</g, "&lt;").replace(/>/g, "&gt;")
        )
        // Escape PHP tags specifically
        .replace(/<\?(?:php)?/gi, "&lt;?php")
        .replace(/\?>/g, "?&gt;")
        // Escape Markdown syntax for literal display
        .replace(/^(#{1,6})\s/gm, (m) => m.replace(/#/g, "&#35;"))
        .replace(/``([^`]+)``/g, "´´$1´´")
        .replace(/`([^`]+)`/g, "´$1´")
        .replace(/\*\*/g, "&#42;&#42;")
        .replace(/(?<!\*)\*(?!\*)/g, "&#42;")
        .replace(/~~(.+?)~~/g, "&#126;&#126;$1&#126;&#126;")
        .replace(/~/g, "&#126;")
        .replace(/^\s*[-*+]\s/gm, (m) =>
          m
            .replace(/-/g, "&#45;")
            .replace(/\*/g, "&#42;")
            .replace(/\+/g, "&#43;")
        )
        .replace(/^\s*\d+\.\s/gm, (m) => m.replace(/\./g, "&#46;"))
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "&#91;$1&#93;&#40;$2&#41;");

      lines[i] = line;
    }
    out = lines.join("\n");
  }

  return out;
};

const rehypeShortcuts = () => {
  return (tree: HastRoot) => {
    visit(
      tree as any,
      (node: any, index: number | null | undefined, parent: any) => {
        if (!parent || typeof index !== "number") return;
        if (node.type !== "element") return;
        if (node.tagName !== "blink-shortcut") return;

        const props = (node.properties as any) || {};
        const encodedName = String(props.name || "").replace(
          /^(?:user-content-)+/,
          ""
        );
        const encodedContent = String(props.content || "").replace(
          /^(?:user-content-)+/,
          ""
        );
        try {
          const name = atob(encodedName);
          const content = atob(encodedContent);
          const shortcutEl = {
            type: "element",
            tagName: "shortcut",
            properties: { name, content },
            children: [],
          } as any;
          const trailing = (node.children as any[]) || [];
          parent.children.splice(index, 1, shortcutEl, ...trailing);
        } catch {
          // If decoding fails, drop tag but keep any children
          const trailing = (node.children as any[]) || [];
          parent.children.splice(index, 1, ...trailing);
        }
      }
    );
  };
};

const remarkPlugins = [remarkGfm];

const sanitizeSchema: any = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "blink-citation",
    "blink-shortcut",
  ],
  attributes: {
    ...(defaultSchema.attributes || {}),
    "blink-citation": ["id"],
    "blink-shortcut": ["name", "content"],
  },
};

interface MarkdownProps {
  children: string;
  role?: string;
}

const NonMemoizedMarkdown = ({ children, role }: MarkdownProps) => (
  <ReactMarkdown
    remarkPlugins={remarkPlugins}
    rehypePlugins={[
      rehypeRaw,
      [rehypeSanitize, sanitizeSchema],
      rehypeShortcuts,
    ]}
    components={components}
  >
    {preprocessText(children, role)}
  </ReactMarkdown>
);

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.role === nextProps.role
);

const FileSyntaxHighlighter = ({
  content,
  path,
  maxHeight = "24rem",
  maxWidth = "48rem",
  startingLineNumber = 1,
}: {
  content: string;
  path?: string;
  maxHeight?: string;
  maxWidth?: string;
  startingLineNumber?: number;
}) => {
  const { resolvedTheme } = useTheme();

  const language = path ? getLanguageFromExtension(path) : "text";

  return (
    <div style={{ maxHeight, maxWidth }} className="overflow-auto">
      <SyntaxHighlighter
        language={language}
        startingLineNumber={startingLineNumber || 1}
        showLineNumbers={true}
        // Ensure long lines do not wrap and instead scroll horizontally
        wrapLongLines={false}
        style={resolvedTheme === "dark" ? vscDarkPlus : vs}
        customStyle={{
          background: "transparent",
          margin: 0,
          fontSize: "16px",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-geist-mono)",
            whiteSpace: "pre",
            wordBreak: "normal",
            overflowX: "auto",
          },
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
};

// Detect language from file extension first, then fallback to content heuristics
const getLanguageFromExtension = (filePath: string) => {
  const ext = filePath.split(".").pop()?.toLowerCase();

  const extensionMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    mjs: "javascript",
    cjs: "javascript",

    // Python
    py: "python",
    pyw: "python",
    pyi: "python",

    // Web languages
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",

    // Go
    go: "go",

    // Rust
    rs: "rust",

    // C/C++
    c: "c",
    cpp: "cpp",
    cxx: "cpp",
    cc: "cpp",
    h: "c",
    hpp: "cpp",

    // Java/Kotlin
    java: "java",
    kt: "kotlin",
    kts: "kotlin",

    // C#
    cs: "csharp",

    // PHP
    php: "php",

    // Ruby
    rb: "ruby",

    // Shell
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    fish: "bash",

    // Config files
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",

    // SQL
    sql: "sql",

    // Markdown
    md: "markdown",
    mdx: "markdown",

    // Docker
    dockerfile: "dockerfile",

    // Other
    txt: "text",
    log: "text",
  };

  return extensionMap[ext || "text"];
};
