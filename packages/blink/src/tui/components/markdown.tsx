import { Text } from "ink";
import { Lexer, Parser, setOptions, marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { memo, useMemo, useRef } from "react";

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

export default memo(
  ({
    children,
    maxWidth,
    id,
    streaming,
  }: {
    id: string;
    children: string;
    maxWidth?: number;
    streaming?: boolean;
  }) => {
    const blocks = useMemo(() => parseMarkdownIntoBlocks(children), [children]);
    const lastBlockCountRef = useRef<number>(0);

    // Track the number of completed blocks (all blocks except the last one during streaming)
    const completedBlockCount = useMemo(() => {
      if (!streaming) {
        lastBlockCountRef.current = 0;
        return 0;
      }

      // If we have more blocks than before, update completed count
      const currentBlockCount = Math.max(0, blocks.length - 1);
      if (currentBlockCount > lastBlockCountRef.current) {
        lastBlockCountRef.current = currentBlockCount;
      }

      return lastBlockCountRef.current;
    }, [blocks.length, streaming]);

    return blocks.map((block, index) => {
      // During streaming, completed blocks get stable keys based on their index
      // This prevents them from re-rendering as new content streams in
      const isCompleted = streaming && index < completedBlockCount;
      const key = isCompleted
        ? `${id}-stable-${index}`
        : `${id}-block-${index}`;

      return (
        <MemoizedMarkdownBlock key={key} children={block} maxWidth={maxWidth} />
      );
    });
  },
  (prevProps, nextProps) => {
    return (
      prevProps.children === nextProps.children &&
      prevProps.maxWidth === nextProps.maxWidth &&
      prevProps.streaming === nextProps.streaming
    );
  }
);

const MemoizedMarkdownBlock = memo(
  ({ children, maxWidth }: { children: string; maxWidth?: number }) => {
    return <MarkdownBlock maxWidth={maxWidth}>{children}</MarkdownBlock>;
  },
  (prevProps, nextProps) => {
    return (
      prevProps.children === nextProps.children &&
      prevProps.maxWidth === nextProps.maxWidth
    );
  }
);

const MarkdownBlock = memo(
  ({ children, maxWidth }: { children: string; maxWidth?: number }) => {
    const cap = maxWidth ?? process.stdout.columns ?? 80;
    const tokens = Lexer.lex(children);
    const out: string[] = [];
    const buf: any[] = [];

    const flush = () => {
      if (!buf.length) return;
      setOptions({
        renderer: new TerminalRenderer({ width: cap }) as any,
      });
      out.push(Parser.parse(buf).trim());
      buf.length = 0;
    };

    for (const t of tokens) {
      if (t.type !== "table") {
        buf.push(t);
        continue;
      }
      flush();
      const colWidths = colWidthsFromTableToken(t, cap);
      setOptions({
        renderer: new TerminalRenderer({
          tableOptions: { colWidths, wordWrap: true },
        }) as any,
      });
      out.push(Parser.parse([t]).trim());
    }
    flush();

    const result = out
      .filter((s) => s)
      .join("\n")
      .trim()
      .replace(/\n\n+/g, "\n");
    return <Text>{result.trim()}</Text>;
  },
  (prevProps, nextProps) => {
    return (
      prevProps.children === nextProps.children &&
      prevProps.maxWidth === nextProps.maxWidth
    );
  }
);

const cellText = (cell: any): string => {
  if (!cell) return "";
  if (typeof cell === "string") return cell;
  if (typeof cell.text === "string") return cell.text; // marked tablecell.token.text
  if (typeof cell.raw === "string") return cell.raw; // fallback
  if (Array.isArray(cell.tokens)) {
    return cell.tokens.map((t: any) => t.raw ?? t.text ?? "").join("");
  }
  return String(cell);
};

const longestWord = (val: any) => {
  const s = cellText(val);
  return s.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
};

function colWidthsFromTableToken(t: any, cap: number) {
  const cols = t.header.length;
  const rows: string[][] = [
    t.header.map(cellText),
    ...t.rows.map((r: any[]) => r.map(cellText)),
  ];

  const demand = Array.from({ length: cols }, (_, i) =>
    rows.reduce(
      (m, r) => Math.max(m, (r[i] ?? "").length, longestWord(r[i] ?? "")),
      0
    )
  );

  const overhead = cols + 1 + cols * 2; // borders + padding
  const available = Math.max(cap - overhead, cols * 6);
  const sum = demand.reduce((a, b) => a + b, 0) || cols;

  let widths = demand.map((d) =>
    Math.max(6, Math.floor((d / sum) * available))
  );
  let delta = available - widths.reduce((a, b) => a + b, 0);

  for (let i = 0; delta !== 0 && i < cols; i = (i + 1) % cols) {
    const next = widths[i]! + Math.sign(delta);
    if (next >= 6) {
      widths[i] = next;
      delta -= Math.sign(delta);
    } else i++;
  }
  return widths;
}
