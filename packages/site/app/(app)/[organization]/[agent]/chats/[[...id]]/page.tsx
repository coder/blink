import { auth } from "@/app/(auth)/auth";
import Chat from "@/components/chat";
import ChatSidebar from "@/components/chat-sidebar";
import { getQuerier } from "@/lib/database";
import { slugToUuid } from "@/lib/utils";
import * as convert from "@blink.so/database/convert";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAgent, getOrganization, getUser } from "../../../layout";

export async function generateMetadata(props: {
  params: Promise<{ organization: string; agent: string; id?: string[] }>;
}): Promise<Metadata> {
  const session = await auth();
  const params = await props.params;
  const { organization, agent } = params;
  if (!session?.user?.id) {
    return { title: "Blink" };
  }
  const [org, ag] = await Promise.all([
    getOrganization(session.user.id, organization),
    getAgent(organization, agent),
  ]);
  const chatSlug = params.id && params.id.length > 0 ? params.id[0] : undefined;
  let chatTitle: string | undefined;
  if (chatSlug) {
    const db = await getQuerier();
    const chat = await db.selectChatByID({ id: slugToUuid(chatSlug) });
    chatTitle = chat?.title ?? undefined;
  }
  const prefix = chatTitle ? `${chatTitle} - ` : "";
  return { title: `${prefix}${ag.name} - Blink` };
}

export default async function ChatsPage({
  params: paramsPromise,
}: {
  params: Promise<{ organization: string; agent: string; id?: string[] }>;
}) {
  const session = await auth();
  if (!session || !session?.user?.id) {
    return redirect("/login");
  }
  const params = await paramsPromise;
  const userID = session.user.id;
  const id =
    params.id && params.id.length > 0 ? slugToUuid(params.id[0]) : undefined;
  const [organization, agent, user] = await Promise.all([
    getOrganization(userID, params.organization),
    getAgent(params.organization, params.agent),
    getUser(userID),
  ]);
  const db = await getQuerier();
  const chat = id ? await db.selectChatByID({ id }) : null;
  if (id && !chat) {
    notFound();
  }

  return (
    <div className="flex flex-row flex-1 max-h-full">
      <ChatSidebar
        hrefBase={`/${params.organization}/${params.agent}/chats`}
        user={user}
        agentID={agent.id}
      />
      <Chat
        user={user}
        initialMessages={[]}
        id={id}
        agent={agent}
        chat={chat ? convert.chat(chat) : undefined}
      />
    </div>
  );
}
