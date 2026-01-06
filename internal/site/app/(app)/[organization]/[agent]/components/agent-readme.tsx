"use client";

import { Markdown } from "@/components/markdown";

interface AgentReadmeProps {
  content: string;
}

export default function AgentReadme({ content }: AgentReadmeProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <Markdown>{content}</Markdown>
    </div>
  );
}
