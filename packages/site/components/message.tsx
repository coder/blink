"use client";

import { cn, formatFullTimestamp, formatTimestamp } from "@/lib/utils";
import { isToolUIPart, type UIMessage } from "ai";
import { motion } from "framer-motion";
import { memo, useRef } from "react";
import { FilePart } from "./file-part";
import { LogoBlinkHopping } from "./icons";
import { Markdown } from "./markdown";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { ToolCall } from "./tool-call";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const PurePreviewMessage = ({
  message,
  canEditMessage,
  showTimestamp,
  isStreaming,
  chatId,
  isLatestMessage,
  showDebug = false,
}: {
  message: UIMessage;
  showTimestamp: boolean;
  canEditMessage: boolean;
  isStreaming: boolean;
  isLatestMessage: boolean;
  chatId: string;
  showDebug?: boolean;
}) => {
  const messageContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={messageContainerRef}
      id={`message-${message.id}`}
      data-testid={`message-${message.role}`}
      className={cn(
        "w-full mx-auto max-w-3xl px-2 sm:px-4 group/message text-stone-900 dark:text-stone-300",
        {
          "flex flex-col items-end py-2": message.role === "user",
        }
      )}
      data-role={message.role}
    >
      <div
        className={cn("relative", {
          "max-w-[85%]": message.role === "user",
        })}
      >
        {/* Timestamp - positioned absolutely to not affect layout width */}
        <div
          className={cn(
            "absolute top-2 pr-2",
            {
              "-left-2 -translate-x-full top-1": message.role === "assistant",
              "right-0 translate-x-full pl-3": message.role === "user",
            },
            showTimestamp ? "block" : "hidden"
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono cursor-help select-none whitespace-nowrap">
                {formatTimestamp(
                  (message as any).createdAt
                    ? new Date((message as any).createdAt)
                    : new Date()
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {formatFullTimestamp(
                (message as any).createdAt
                  ? new Date((message as any).createdAt)
                  : new Date()
              )}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex gap-1 w-full">
          {/* Message Content */}
          <div
            className={cn({
              "flex flex-col gap-1.5 w-full min-w-0 font-base bg-stone-50 dark:bg-neutral-800 rounded-2xl rounded-br-md px-4 py-1 border border-stone-200 dark:border-neutral-700":
                message.role === "user",
              "flex flex-col gap-1.5 w-full min-w-0 font-base":
                message.role === "assistant",
            })}
          >
            {message.parts?.map((part, index) => {
              const key = `${message.id}-${index}`;
              if (part.type === "reasoning") {
                return (
                  <MessageReasoning
                    key={key}
                    isStreaming={isStreaming}
                    reasoning={part.text}
                  />
                );
              }

              if (part.type === "text") {
                return (
                  <div
                    key={key}
                    className="flex flex-row gap-2 items-start relative"
                  >
                    <div
                      data-testid="message-content"
                      className="flex flex-col gap-0.5 w-full min-w-0 prose-sm prose-neutral dark:prose-invert max-w-none leading-relaxed prose-code:before:content-none prose-code:after:content-none overflow-wrap-anywhere break-words text-base"
                    >
                      <Markdown role={message.role}>{part.text}</Markdown>
                    </div>
                  </div>
                );
              }

              // Render file parts - handle different media types appropriately
              if (part.type === "file") {
                return <FilePart key={key} part={part} />;
              }

              if (isToolUIPart(part)) {
                return (
                  <ToolCall
                    key={part.toolCallId}
                    message={message}
                    toolInvocation={part}
                    isStreaming={isStreaming}
                    isLatestMessage={isLatestMessage}
                  />
                );
              }

              return null;
            })}
          </div>
        </div>
      </div>

      {/* Copy buttons positioned outside the message bubble */}
      <div
        className={cn("mt-2", {
          "flex justify-end": message.role === "user", // Align right for user messages
          "flex justify-start": message.role === "assistant", // Align left for assistant messages
        })}
      >
        <MessageActions
          chatId={chatId}
          message={message}
          isLoading={isStreaming}
          showDebug={showDebug}
        />
      </div>
    </div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isStreaming !== nextProps.isStreaming) return false;
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.showTimestamp !== nextProps.showTimestamp) return false;
    if (prevProps.isLatestMessage !== nextProps.isLatestMessage) return false;
    if (prevProps.showDebug !== nextProps.showDebug) return false;

    // Only rerender if the component updates and the message is streaming.
    // If the message is not streaming, we don't need to rerender.
    return !nextProps.isStreaming;
  }
);

const ThinkingMessage = memo(() => {
  return (
    <motion.div
      data-testid="message-assistant-loading"
      className="w-full mx-auto max-w-3xl px-2 sm:px-4 group/message text-stone-300 mt-6"
      initial={{ y: 5, opacity: 0 }}
      animate={{ y: 0, opacity: 1, transition: { delay: 0.5 } }}
      data-role="assistant"
    >
      <div className="flex gap-2 w-full">
        <div className="shrink-0">
          <div className="size-8 rounded-md flex items-center justify-center">
            <div className="-mt-3">
              <LogoBlinkHopping size={52} animate={true} />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 w-full min-w-0">
          <div className="text-base text-stone-400 italic">Blinking...</div>
        </div>
      </div>
    </motion.div>
  );
});
