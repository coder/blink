import { auth } from "@/app/(auth)/auth";
import Header from "@/components/header";
import { getQuerier } from "@/lib/database";
import * as convert from "@blink.so/database/convert";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NewPageClient } from "./client";

export const metadata: Metadata = {
  title: "Create a new agent - Blink",
  description: "Use the Blink CLI to create and deploy Slack agents",
};

export default async function NewPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return redirect("/login");
  }

  const querier = await getQuerier();
  const dbUser = await querier.selectUserByID(session.user.id);

  if (!dbUser) {
    return redirect("/login");
  }

  const user = convert.user(dbUser);
  const params = await searchParams;
  const organizationName = params.org || user.username;

  return (
    <div className="w-full relative">
      <Header user={user} />
      <NewPageClient organizationName={organizationName} />
    </div>
  );
}
