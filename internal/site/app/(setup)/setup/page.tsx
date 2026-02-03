import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPublicSignupStatus } from "@/lib/signups";

import { SetupForm } from "./setup-form";

export const metadata: Metadata = {
  title: "Setup - Blink",
  description: "Create your Blink admin account.",
};

interface SetupPageProps {
  searchParams: { error?: string; redirect?: string };
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const { isFirstUser } = await getPublicSignupStatus();

  // If not first user, redirect to normal signup
  if (!isFirstUser) {
    redirect("/signup");
  }

  const sp = await searchParams;
  const { error, redirect: redirectTarget } = sp as {
    error?: string;
    redirect?: string;
  };

  return <SetupForm redirect={redirectTarget} error={error} />;
}
