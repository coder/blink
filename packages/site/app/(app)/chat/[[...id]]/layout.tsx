import { auth } from "@/app/(auth)/auth";
import ChatSidebar from "@/components/chat-sidebar";
import Header from "@/components/header";
import { getQuerier } from "@/lib/database";
import * as convert from "@blink.so/database/convert";
import type { UserWithPersonalOrganization } from "@blink.so/database/schema";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  let user: UserWithPersonalOrganization | undefined;
  if (session?.user) {
    const querier = await getQuerier();
    user = await querier.selectUserByID(session.user.id);
  }
  return (
    <>
      <Header user={user ? convert.user(user) : undefined} />
      <div className="flex flex-row max-h-[calc(100vh-var(--header-height))] flex-1">
        {user && <ChatSidebar hrefBase={"/chat"} user={convert.user(user)} />}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
