import { auth } from "@/app/(auth)/auth";
import Header from "@/components/header";
import { getQuerier } from "@/lib/database";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrganization, getUser } from "../layout";
import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = {
  title: "Get Started - Blink",
};

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return redirect("/login");
  }

  const { organization: organizationName } = await params;
  const db = await getQuerier();
  const organization = await getOrganization(session.user.id, organizationName);
  const user = await getUser(session.user.id);

  // Check if org already has agents - redirect to dashboard if so
  const agents = await db.selectAgentsForUser({
    userID: session.user.id,
    organizationID: organization.id,
    per_page: 1,
  });

  if (agents.items.length > 0) {
    return redirect(`/${organizationName}`);
  }

  return (
    <div className="w-full relative min-h-screen">
      <Header user={user} organization={organization} />
      <OnboardingWizard
        organizationId={organization.id}
        organizationName={organizationName}
      />
    </div>
  );
}
