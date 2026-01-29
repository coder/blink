import { getQuerier } from "@/lib/database";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "Setup - Blink",
  description: "Create your Blink admin account.",
};

interface SetupPageProps {
  searchParams: { error?: string; redirect?: string };
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  // Check if this is actually the first user
  const db = await getQuerier();
  const teamOrgs = await db.selectTeamOrganizations();

  // If not first user, redirect to normal signup
  if (teamOrgs.length > 0) {
    redirect("/signup");
  }

  const sp = await searchParams;
  const { error, redirect: redirectTarget } = sp as {
    error?: string;
    redirect?: string;
  };

  return <SetupForm redirect={redirectTarget} error={error} />;
}
