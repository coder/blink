"use client";

import { AnimatePresence, motion } from "framer-motion";
import { memo, useEffect, useState } from "react";
import { ChevronDownIcon, LoaderIcon } from "./icons";
import { Markdown } from "./markdown";

interface MessageReasoningProps {
  isStreaming: boolean;
  reasoning: string;
}

function PureMessageReasoning({
  isStreaming,
  reasoning,
}: MessageReasoningProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  useEffect(() => {
    setIsExpanded(isStreaming);
  }, [isStreaming]);

  const variants = {
    collapsed: {
      height: 0,
      opacity: 0,
      marginTop: 0,
      marginBottom: 0,
    },
    expanded: {
      height: "auto",
      opacity: 1,
      marginTop: "1rem",
      marginBottom: "0.5rem",
    },
  };

  return (
    <div className="flex flex-col">
      {isStreaming ? (
        <div className="flex flex-row gap-2 items-center">
          <div className="text-base">Reasoning</div>
          <div className="animate-spin">
            <LoaderIcon />
          </div>
        </div>
      ) : (
        <div className="flex flex-row gap-2 items-center">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Reasoned for a few seconds
          </div>
          <button
            data-testid="message-reasoning-toggle"
            type="button"
            className="cursor-pointer"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
          >
            <ChevronDownIcon />
          </button>
        </div>
      )}

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            data-testid="message-reasoning"
            key="content"
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            variants={variants}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
            className="pl-4 border-l flex flex-col gap-4 prose-sm prose-neutral dark:prose-invert max-w-none leading-relaxed prose-code:before:content-none prose-code:after:content-none overflow-wrap-anywhere break-words text-base text-zinc-600 dark:text-zinc-400"
          >
            <Markdown>{reasoning}</Markdown>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const MessageReasoning = memo(PureMessageReasoning);
