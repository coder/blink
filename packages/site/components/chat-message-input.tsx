import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  ParagraphNode,
  PASTE_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
} from "lexical";
import * as React from "react";

// Shortcut type (placeholder for removed schema type)
type Shortcut = { id: string; name: string };

// Get caret overlay position (end of current word/caret)
function getCaretOverlayPosition(
  editor: LexicalEditor
): { top: number; left: number } | null {
  const nativeSelection = window.getSelection();
  const rootElement = editor.getRootElement();
  if (!nativeSelection?.rangeCount || !rootElement) return null;

  const range = nativeSelection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const editorRect = rootElement.getBoundingClientRect();

  // Place overlay starting at caret end
  const left = Math.max(0, rect.right - editorRect.left);
  const top = Math.max(0, rect.top - editorRect.top);
  return { top, left };
}

// Ghost text plugin - displays suggestion ghost text and accepts via Right Arrow
const GhostTextPlugin: React.FC<{
  ghostText?: string;
  onAcceptGhostText?: () => void;
  onCancelGhostText?: () => void;
}> = React.memo(function GhostTextPlugin({
  ghostText,
  onAcceptGhostText,
  onCancelGhostText,
}) {
  const [editor] = useLexicalComposerContext();
  const [position, setPosition] = React.useState<{
    top?: number;
    bottom?: number;
    left: number;
  }>({ left: 0 });
  const [isCollapsed, setIsCollapsed] = React.useState(true);
  // We intentionally do not cancel on caret movement caused by typing; only on explicit user moves

  React.useEffect(() => {
    // Keep a mouse-down cancel so clicks cancel immediately
    const root = editor.getRootElement();
    const onMouseDown = () => onCancelGhostText?.();
    root?.addEventListener("mousedown", onMouseDown, { capture: true });

    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            setIsCollapsed(selection.isCollapsed());
          }
          const pos = getCaretOverlayPosition(editor);
          if (pos) setPosition(pos);
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          editor.getEditorState().read(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection)) {
              setIsCollapsed(false);
              onCancelGhostText?.();
              return;
            }
            const collapsed = selection.isCollapsed();
            setIsCollapsed(collapsed);
            if (!collapsed) {
              onCancelGhostText?.();
            }
          });
          const pos = getCaretOverlayPosition(editor);
          if (pos) setPosition(pos);
          return false;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event: KeyboardEvent | null) => {
          if (ghostText && ghostText.length > 0) {
            event?.preventDefault();
            onAcceptGhostText?.();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ARROW_LEFT_COMMAND,
        () => {
          onCancelGhostText?.();
          return false;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        () => {
          onCancelGhostText?.();
          return false;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        () => {
          onCancelGhostText?.();
          return false;
        },
        COMMAND_PRIORITY_HIGH
      ),
      () => {
        root?.removeEventListener("mousedown", onMouseDown, {
          capture: true,
        } as any);
      }
    );
  }, [editor, onAcceptGhostText, onCancelGhostText, ghostText]);

  if (!ghostText || ghostText.length === 0 || !isCollapsed) return null;

  return (
    <div
      style={{
        position: "absolute",
        pointerEvents: "none",
        color: "var(--muted-foreground)",
        fontStyle: "italic",
        top: position.top,
        bottom: position.bottom,
        left: position.left,
        whiteSpace: "pre-wrap",
        maxWidth: "100%",
        zIndex: 1000,
      }}
    >
      {ghostText}
    </div>
  );
});

// Disable formatting plugin - blocks bold/italic/underline and element formatting
const DisableFormattingPlugin: React.FC = React.memo(
  function DisableFormattingPlugin() {
    const [editor] = useLexicalComposerContext();

    React.useEffect(() => {
      const unregisterText = editor.registerCommand(
        FORMAT_TEXT_COMMAND,
        () => true,
        COMMAND_PRIORITY_HIGH
      );
      const unregisterElement = editor.registerCommand(
        FORMAT_ELEMENT_COMMAND,
        () => true,
        COMMAND_PRIORITY_HIGH
      );
      return () => {
        unregisterText();
        unregisterElement();
      };
    }, [editor]);

    return null;
  }
);

// Paste sanitization plugin - ensures paste inserts plain text only
const PasteSanitizationPlugin: React.FC = React.memo(
  function PasteSanitizationPlugin() {
    const [editor] = useLexicalComposerContext();

    React.useEffect(() => {
      const unregister = editor.registerCommand(
        PASTE_COMMAND,
        (event: ClipboardEvent | null) => {
          if (!event) return false as boolean;
          const clipboardData = event.clipboardData;
          if (!clipboardData) return false as boolean;

          const text = clipboardData.getData("text/plain");
          // Only handle when there is textual content to insert; allow other handlers (e.g. image upload) otherwise
          if (!text) return false as boolean;

          event.preventDefault();

          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              // Insert as plain text; keep any shortcut tokens verbatim
              selection.insertText(text);
            } else {
              const root = $getRoot();
              const lastChild = root.getLastChild();
              if (lastChild) {
                if (lastChild.getType() === "paragraph") {
                  const paragraph = lastChild as ParagraphNode;
                  const textNode = $createTextNode(text);
                  paragraph.append(textNode);
                  textNode.selectEnd();
                } else {
                  const textNode = $createTextNode(text);
                  lastChild.insertAfter(textNode);
                  textNode.selectEnd();
                }
              } else {
                const paragraph = $createParagraphNode();
                const textNode = $createTextNode(text);
                paragraph.append(textNode);
                root.append(paragraph);
                textNode.selectEnd();
              }
            }
          });

          return true;
        },
        COMMAND_PRIORITY_HIGH
      );
      return unregister;
    }, [editor]);

    return null;
  }
);

// Enter Key Plugin - handles Enter key submission
const EnterKeyPlugin: React.FC<{ onEnter?: () => void }> = React.memo(
  function EnterKeyPlugin({ onEnter }) {
    const [editor] = useLexicalComposerContext();
    const isMobile = useIsMobile();

    React.useEffect(() => {
      const unregister = editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event: KeyboardEvent | null) => {
          // Shift+Enter should create a newline
          if (event && event.shiftKey) {
            return false;
          }
          // On mobile, Enter should create a newline, not send
          if (isMobile) {
            return false;
          }
          // Otherwise, submit the form
          if (onEnter) {
            event?.preventDefault();

            editor.update(() => {
              const root = $getRoot();
              root.clear();
              const paragraph = $createParagraphNode();
              root.append(paragraph);
              paragraph.select();
            });

            onEnter();

            setTimeout(() => {
              editor.focus();
            }, 50);
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH
      );
      return unregister;
    }, [editor, onEnter, isMobile]);

    return null;
  }
);

// Insert Text Plugin - exposes editor for text insertion
const InsertTextPlugin = React.memo(function InsertTextPlugin({
  onEditorReady,
}: {
  onEditorReady: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    onEditorReady(editor);
  }, [editor, onEditorReady]);

  return null;
});

// Content Change Plugin - notifies parent of content changes
const ContentChangePlugin = React.memo(function ContentChangePlugin({
  onChange,
}: {
  onChange?: (content: string) => void;
}) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    if (!onChange) return;

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const content = root.getTextContent();
        onChange(content);
      });
    });
  }, [editor, onChange]);

  return null;
});

// Value Sync Plugin - handles syncing external value with editor content
const ValueSyncPlugin = React.memo(function ValueSyncPlugin({
  initialValue,
}: {
  initialValue?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const hasInitialized = React.useRef(false);

  React.useEffect(() => {
    if (!hasInitialized.current && initialValue !== undefined) {
      hasInitialized.current = true;

      editor.update(() => {
        const root = $getRoot();
        root.clear();

        if (initialValue === "") {
          return;
        }

        const paragraph = $createParagraphNode();
        const textNode = $createTextNode(initialValue);
        paragraph.append(textNode);
        root.append(paragraph);
      });
    }
  }, [editor, initialValue]);

  return null;
});

// Props
interface ChatMessageInputProps
  extends Omit<React.ComponentProps<"div">, "onChange" | "role"> {
  placeholder?: string;
  initialValue?: string;
  onChange?: (event: { target: { value: string } }) => void;
  rows?: number;
  onEnter?: () => void;
  disabled?: boolean;
  required?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  name?: string;
  autoFocus?: boolean;
  dir?: string;
  onShortcutSelect?: (shortcut: Shortcut) => void;
  ghostText?: string;
  onAcceptGhostText?: () => void;
  onCancelGhostText?: () => void;
}

// Ref interface for ChatMessageInput
export interface ChatMessageInputRef {
  insertText: (text: string) => void;
  clear: () => void;
  focus: () => void;
}

// Main Component
const ChatMessageInput = React.memo(
  React.forwardRef<ChatMessageInputRef, ChatMessageInputProps>(
    (
      {
        className,
        placeholder,
        initialValue,
        onChange,
        rows,
        onEnter,
        disabled,
        required,
        name,
        autoFocus,
        dir,
        onShortcutSelect,
        ghostText,
        onAcceptGhostText,
        onCancelGhostText,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledby,
        "aria-describedby": ariaDescribedby,
        "aria-invalid": ariaInvalid,
        ...props
      },
      ref
    ) => {
      const initialConfig = React.useMemo(
        () => ({
          namespace: "ChatMessageInput",
          theme: {
            paragraph: "m-0",
          },
          onError: (error: Error) => console.error("Lexical error:", error),
          nodes: [],
        }),
        [initialValue]
      );

      const style = React.useMemo(
        () => ({ minHeight: rows ? `${rows * 1.5}rem` : "80px" }),
        [rows]
      );

      const editorRef = React.useRef<LexicalEditor | null>(null);

      const handleEditorReady = React.useCallback((editor: LexicalEditor) => {
        editorRef.current = editor;
      }, []);

      const handleContentChange = React.useCallback(
        (content: string) => {
          onChange?.({ target: { value: content } });
        },
        [onChange]
      );

      React.useImperativeHandle(
        ref,
        () => ({
          insertText: (text: string) => {
            const editor = editorRef.current;
            if (!editor) return;

            editor.update(() => {
              const selection = $getSelection();
              if ($isRangeSelection(selection)) {
                const textNode = $createTextNode(text);
                $insertNodes([textNode]);
                textNode.selectEnd();
              } else {
                const root = $getRoot();
                const lastChild = root.getLastChild();
                if (lastChild) {
                  if (lastChild.getType() === "paragraph") {
                    const paragraph = lastChild as ParagraphNode;
                    const textNode = $createTextNode(text);
                    paragraph.append(textNode);
                    textNode.selectEnd();
                  } else {
                    const textNode = $createTextNode(text);
                    lastChild.insertAfter(textNode);
                    textNode.selectEnd();
                  }
                } else {
                  const paragraph = $createParagraphNode();
                  const textNode = $createTextNode(text);
                  paragraph.append(textNode);
                  root.append(paragraph);
                  textNode.selectEnd();
                }
              }
            });
          },
          clear: () => {
            const editor = editorRef.current;
            if (!editor) return;

            editor.update(() => {
              const root = $getRoot();
              root.clear();
              const paragraph = $createParagraphNode();
              root.append(paragraph);
              paragraph.select();
            });
          },
          focus: () => {
            const editor = editorRef.current;
            if (!editor) return;
            editor.focus(() => {
              const root = $getRoot();
              const last = root.getLastChild();
              if (!last) {
                const paragraph = $createParagraphNode();
                root.append(paragraph);
                paragraph.select();
                return;
              }
              if (last instanceof ParagraphNode) {
                last.selectEnd();
              } else {
                last.selectEnd();
              }
            });
          },
        }),
        []
      );

      return (
        <div className="relative">
          <LexicalComposer initialConfig={initialConfig}>
            <div
              className={cn(
                "min-h-[80px] w-full rounded-md bg-background text-base placeholder:text-muted-foreground focus-visible:outline-none md:text-md whitespace-pre-wrap break-words",
                disabled && "cursor-not-allowed opacity-50",
                className
              )}
              style={style}
              {...props}
            >
              <RichTextPlugin
                contentEditable={
                  <div
                    className="relative w-full"
                    style={{ minHeight: "inherit" }}
                  >
                    <ContentEditable
                      className="outline-none p-0 whitespace-pre-wrap [&_p]:leading-normal [&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
                      data-testid="chat-message-input-content"
                      style={{ minHeight: "inherit" }}
                      aria-label={ariaLabel}
                      aria-labelledby={ariaLabelledby}
                      aria-describedby={ariaDescribedby}
                      aria-invalid={ariaInvalid}
                      aria-required={required}
                    />
                    <GhostTextPlugin
                      ghostText={ghostText}
                      onAcceptGhostText={onAcceptGhostText}
                      onCancelGhostText={onCancelGhostText}
                    />
                  </div>
                }
                placeholder={
                  <div className="absolute top-0 left-1 text-muted-foreground pointer-events-none leading-normal">
                    {placeholder}
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              {/* Block formatting shortcuts like Cmd/Ctrl+B/I/U and element formatting */}
              <DisableFormattingPlugin />
              {/* Ensure pastes are sanitized to plain text while preserving shortcut tokens */}
              <PasteSanitizationPlugin />
              <EnterKeyPlugin onEnter={onEnter} />
              <ContentChangePlugin onChange={handleContentChange} />
              <ValueSyncPlugin initialValue={initialValue} />
              <InsertTextPlugin onEditorReady={handleEditorReady} />
              {autoFocus && <AutoFocusPlugin />}
            </div>
          </LexicalComposer>
        </div>
      );
    }
  ),
  (prevProps, nextProps) => {
    if (prevProps.initialValue !== nextProps.initialValue) return false;
    if (prevProps.placeholder !== nextProps.placeholder) return false;
    if (prevProps.className !== nextProps.className) return false;
    if (prevProps.rows !== nextProps.rows) return false;
    if (prevProps.disabled !== nextProps.disabled) return false;
    if (prevProps.autoFocus !== nextProps.autoFocus) return false;
    if (prevProps.onChange !== nextProps.onChange) return false;
    if (prevProps.onEnter !== nextProps.onEnter) return false;
    if (prevProps.onShortcutSelect !== nextProps.onShortcutSelect) return false;
    if (prevProps.ghostText !== nextProps.ghostText) return false;
    if (prevProps.onAcceptGhostText !== nextProps.onAcceptGhostText)
      return false;
    if (prevProps.onCancelGhostText !== nextProps.onCancelGhostText)
      return false;

    return true;
  }
);

ChatMessageInput.displayName = "ChatMessageInput";

export { ChatMessageInput };
