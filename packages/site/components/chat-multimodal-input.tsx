"use client";

import { useAttachments, type UIAttachment } from "@/hooks/use-attachments";
import { useChatMessagesScroll } from "@/hooks/use-chat-messages-scroll";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PartialFile } from "@blink.so/database/schema";
import cx from "classnames";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp } from "lucide-react";
import type React from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ChatMessageInput,
  type ChatMessageInputRef,
} from "./chat-message-input";
import { LogoBlinkTwist, PaperclipIcon } from "./icons";
import { MicrophoneButton } from "./microphone-button";
import { PreviewAttachment } from "./preview-attachment";
import { Button } from "./ui/button";

// Shortcut type (placeholder for removed schema type)
type Shortcut = { id: string; name: string };

export function ChatMultimodalInput({
  className,
  messageInputRef,
  inputValueRef,
  id,
  submit,
  stop,
  streaming,
  adornment,
  ghostText,
  onAcceptGhostText,
  onInputChange,
  onCancelGhostText,
}: {
  className?: string;
  messageInputRef?: React.RefObject<ChatMessageInputRef | null>;
  inputValueRef?: React.RefObject<string>;
  id?: string;
  submit?: (message: string, options: { attachments: PartialFile[] }) => void;
  stop?: () => void;
  streaming?: boolean;
  adornment?: React.ReactNode;
  ghostText?: string;
  onAcceptGhostText?: () => void;
  onInputChange?: (text: string) => void;
  onCancelGhostText?: () => void;
}) {
  const isMobile = useIsMobile();
  if (!messageInputRef) {
    messageInputRef = useRef<ChatMessageInputRef>(null);
  }

  const inputLocalStorageKey = useMemo(() => {
    if (id) {
      return `chat-draft-${id}`;
    }
    return "chat-draft";
  }, [id]);
  // Handle localStorage for chat drafts.
  const inputLocalStorageValue = useMemo(() => {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(inputLocalStorageKey)
      : "";
  }, [inputLocalStorageKey]);
  // A ref is used to prevent re-rendering when the input value changes.
  if (!inputValueRef) {
    inputValueRef = useRef<string>(inputLocalStorageValue ?? "");
  }
  const [hasInput, setHasInput] = useState(false);
  const handleInput = useCallback(
    (
      event:
        | React.ChangeEvent<HTMLTextAreaElement>
        | { target: { value: string } }
    ) => {
      const newValue = event.target.value;
      inputValueRef.current = newValue;
      if (newValue.length > 0) {
        setHasInput(true);
      } else {
        setHasInput(false);
      }
      window.localStorage.setItem(inputLocalStorageKey, newValue);
      onInputChange?.(newValue);
    },
    [inputLocalStorageKey]
  );

  const {
    attachments,
    upload: uploadAttachment,
    clear: clearAttachments,
    remove: removeAttachment,
    uploading,
  } = useAttachments();
  const [isRecording, setIsRecording] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const submitForm = useCallback(() => {
    // Don't submit if files are still uploading
    if (uploading) {
      return;
    }

    // Don't submit if there's no input and no attachments
    if (!hasInput && attachments.length === 0) {
      return;
    }

    submit?.(inputValueRef.current, {
      attachments: attachments.map((a) => ({
        id: a.id,
        content_type: a.contentType,
        file_name: a.fileName,
        byte_length: a.byteLength,
      })),
    });
    inputValueRef.current = "";
    window.localStorage.removeItem(inputLocalStorageKey);
    // Clear the editor content
    messageInputRef.current?.clear();
    clearAttachments();
  }, [submit, attachments, clearAttachments, uploading, hasInput]);

  // Memoize the shortcut select handler
  const handleShortcutSelect = useCallback((shortcut: Shortcut) => {
    // Handle shortcut selection if needed
    console.log("Shortcut selected:", shortcut);
  }, []);

  // Memoize the placeholder text
  const placeholderText = useMemo(
    () => (isRecording ? "Listening..." : "Send a message..."),
    [isRecording]
  );

  // Memoize the className
  const inputClassName = useMemo(
    () =>
      cx(
        "px-1 min-h-[24px] resize-none rounded-lg text-base! bg-muted",
        !id
          ? "max-h-[300px] overflow-y-auto"
          : "max-h-[calc(50dvh)] overflow-y-auto",
        className
      ),
    [id, className]
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      for (const file of files) {
        uploadAttachment(file);
      }
    },
    []
  );

  // Drag and drop handlers
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    // Only set drag over to false if we're leaving the main container
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
      uploadAttachment(file);
    }
  }, []);

  // Paste handler for images
  const handlePaste = useCallback(async (event: React.ClipboardEvent) => {
    const items = Array.from(event.clipboardData.items).map((i) =>
      i.getAsFile()
    );

    for (const item of items) {
      if (item) {
        uploadAttachment(item);
      }
    }
  }, []);

  const { isAtBottom, scrollToBottom } = useChatMessagesScroll();

  useEffect(() => {
    if (!isMobile) return; // desktop unchanged
    if (streaming && isAtBottom) {
      scrollToBottom("smooth");
    }
  }, [streaming, scrollToBottom, isMobile, isAtBottom]);

  return (
    <div
      className={cx(
        "relative w-full flex flex-col gap-4",
        !id && "items-start"
      )}
    >
      <AnimatePresence>
        {!isAtBottom && id && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="absolute left-1/2 bottom-28 -translate-x-1/2 z-50"
          >
            <Button
              data-testid="scroll-to-bottom-button"
              className="rounded-full"
              size="icon"
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                scrollToBottom("smooth"); // Force scroll when user clicks the button
              }}
            >
              <ArrowDown />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cx(
          "bg-muted p-4 rounded-lg w-full flex flex-col gap-2 relative transition-all duration-500 ease-in-out",
          isDragOver &&
            "ring-2 ring-blue-500 ring-opacity-50 bg-blue-50 dark:bg-blue-950",
          id && "rounded-b-none"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="absolute inset-0 bg-blue-500 bg-opacity-10 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center z-10">
            <div className="text-blue-600 dark:text-blue-400 font-medium">
              Drop files here to upload
            </div>
          </div>
        )}
        <input
          type="file"
          className="fixed -top-4 -left-4 size-0.5 opacity-0 pointer-events-none"
          ref={fileInputRef}
          multiple
          onChange={handleFileChange}
          tabIndex={-1}
        />

        {attachments.length > 0 && (
          <div
            data-testid="attachments-preview"
            className="flex flex-row gap-4 overflow-x-scroll items-end"
          >
            {attachments.map((attachment, index) => (
              <PreviewAttachment
                key={attachment.id}
                attachment={attachment}
                onRemove={() => removeAttachment(attachment.id)}
              />
            ))}
          </div>
        )}

        <ChatMessageInput
          // This key is used to force a re-render when the chat changes.
          key={`chat-message-input-${id}`}
          ref={messageInputRef}
          initialValue={inputLocalStorageValue ?? ""}
          dir="ltr"
          onChange={handleInput}
          placeholder={placeholderText}
          className={inputClassName}
          rows={1}
          onPaste={handlePaste}
          autoFocus
          onEnter={submitForm}
          onShortcutSelect={handleShortcutSelect}
          ghostText={ghostText}
          onAcceptGhostText={onAcceptGhostText}
          onCancelGhostText={onCancelGhostText}
        />

        <div className="flex flex-row items-center gap-2 pt-1">
          {adornment}

          <div className="grow" />
          <MicrophoneButton
            onTranscript={(text) => {
              if (!messageInputRef.current) {
                return;
              }
              messageInputRef.current.insertText(text);
            }}
            onRecordingStateChange={setIsRecording}
          />
          <AttachmentsButton fileInputRef={fileInputRef} />
          {streaming ? (
            <StopButton stop={() => stop?.()} />
          ) : (
            <SendButton
              hasInput={hasInput}
              submitForm={submitForm}
              isUploading={uploading}
              attachments={attachments}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentsButton({
  fileInputRef,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
}) {
  return (
    <Button
      data-testid="attachments-button"
      className="rounded-md p-[7px] size-8 dark:border-zinc-700 hover:dark:bg-zinc-900 hover:bg-zinc-200 flex items-center justify-center"
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      variant="ghost"
    >
      <PaperclipIcon size={14} />
    </Button>
  );
}

function StopButton({ stop }: { stop: () => void }) {
  return (
    <Button
      data-testid="stop-button"
      size="icon"
      className="h-8 w-8 rounded-full border dark:border-zinc-600 bg-black dark:bg-white"
      onClick={(event) => {
        event.preventDefault();
        stop();
      }}
    >
      <LogoBlinkTwist size={32} />
    </Button>
  );
}

function SendButton({
  submitForm,
  hasInput,
  isUploading,
  attachments,
}: {
  submitForm: () => void;
  hasInput: boolean;
  isUploading: boolean;
  attachments: UIAttachment[];
}) {
  return (
    <Button
      data-testid="send-button"
      size="icon"
      className="rounded-full size-8"
      onClick={(event) => {
        event.preventDefault();
        submitForm();
      }}
      disabled={(!hasInput && attachments.length === 0) || isUploading}
    >
      <ArrowUp />
    </Button>
  );
}

export function getInputLocalStorageKey(chatID: string, exists: boolean) {
  if (exists) {
    return `chat-draft-${chatID}`;
  }
  return "chat-draft";
}
