import { auth } from "@/app/(auth)/auth";
import Chat from "@/components/chat";
import { getQuerier } from "@/lib/database";
import { slugToUuid } from "@/lib/utils";
import * as convert from "@blink.so/database/convert";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ id?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  if (!params.id || params.id.length === 0) {
    return {
      title: "Blink",
      description:
        "Start a new conversation with Blink, your AI engineering assistant.",
    };
  }
  const rawId = params.id[0];
  const id = slugToUuid(rawId);
  const session = await auth();
  const notFoundMeta = () => {
    return {
      title: "Chat Not Found - Blink",
      description: "The requested chat could not be found.",
    };
  };
  if (!session?.user?.id) {
    return notFoundMeta();
  }
  return unstable_cache(
    async (): Promise<Metadata> => {
      const querier = await getQuerier();
      const chat = await querier.selectChatByID({ id });

      if (!chat) {
        return notFoundMeta();
      }

      return {
        title: `${chat.title} - Blink`,
        description: `Chat conversation: ${chat.title}`,
      };
    },
    ["chat", session.user.id, rawId],
    {
      tags: ["chat", session.user.id, rawId],
    }
  )();
}

const CODER_ORG_ID = "9d2cef66-36eb-4a32-bd83-e5aca9f993ee";

export default async function Page(props: {
  params: Promise<{ id?: string[] }>;
  searchParams?: Promise<{
    workspace?: string;
    sl?: string;
    collapse_sidebar?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const [params, searchParams] = await Promise.all([
    props.params,
    props.searchParams,
  ]);
  const id =
    params.id && params.id.length > 0 ? slugToUuid(params.id[0]) : undefined;

  // Redirect to personal org unless user is a member of Coder org
  if (!id) {
    const querier = await getQuerier();
    const [user, memberships] = await Promise.all([
      querier.selectUserByID(session.user.id),
      querier.selectOrganizationMembershipsByUserID(session.user.id),
    ]);

    // Prefer oldest team org, fall back to personal org
    const teamOrgs = memberships
      .filter((m) => m.organization.kind === "organization")
      .sort(
        (a, b) =>
          new Date(a.organization.created_at).getTime() -
          new Date(b.organization.created_at).getTime()
      );

    if (teamOrgs.length > 0) {
      redirect(`/${teamOrgs[0].organization.name}`);
    } else if (user?.username) {
      redirect(`/${user.username}`);
    }
  }

  const querier = await getQuerier();
  const [user, chat, messages] = await Promise.all([
    session?.user?.id ? querier.selectUserByID(session.user.id) : null,
    id ? querier.selectChatByID({ id }) : null,
    id ? querier.selectChatMessages({ chatID: id }) : null,
  ]);

  return (
    <Chat
      user={user ? convert.user(user) : undefined}
      id={id}
      initialMessages={
        messages
          ? messages.items
              .map((message) => convert.message("ai-sdk", message))
              .reverse()
          : undefined
      }
      chat={chat ? convert.chat(chat) : undefined}
    />
  );
}
