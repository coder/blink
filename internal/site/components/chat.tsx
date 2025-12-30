"use client";

import type { Agent, Chat, ChatMessage, User } from "@blink.so/api";
import AgentChat from "./agent-chat";
import { LogoBlink } from "./icons";
import Avatar from "./ui/avatar";

export default function Chat({
  user,
  id,
  chat,
  agent,
  initialMessages,
}: {
  user: User | undefined;
  initialMessages: ChatMessage[] | undefined;
  chat?: Chat;
  agent?: Agent;
  id?: string;
}) {
  if (!user) {
    return <div>Only continues existing agent chats right now</div>;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full bg-background border-t border-l rounded-tl-md">
      <AgentChat
        agent={agent ?? chat?.agent}
        organization={user.organization_id}
        id={id}
        messages={initialMessages}
        initialError={chat?.error ?? undefined}
        hideAgentSelector={!!agent}
        emptyState={
          <div className="flex flex-col items-center mb-8">
            <div className="flex flex-row items-center gap-3">
              {agent || chat?.agent ? (
                <Avatar
                  src={(agent ?? chat?.agent)?.avatar_url}
                  size={20}
                  seed={(agent ?? chat?.agent)?.id ?? ""}
                  alt={(agent ?? chat?.agent)?.name}
                />
              ) : (
                <LogoBlink className="invert dark:invert-0" size={20} />
              )}
              {(agent ?? chat?.agent)?.name && (
                <span className="text-2xl font-semibold text-muted-foreground">
                  {(agent ?? chat?.agent)?.name}
                </span>
              )}
              <h1 className="text-2xl font-semibold">How can I help?</h1>
            </div>
          </div>
        }
      />
    </div>
  );
}
