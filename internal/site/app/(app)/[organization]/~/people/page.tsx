import { getOrganization, getUser } from "@/app/(app)/[organization]/layout";
import { auth } from "@/app/(auth)/auth";
import Header from "@/components/header";
import { getEnableMultiOrg } from "@/lib/multi-org";
import { PageContainer, PageHeader } from "@/components/page-header";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OrganizationNavigation } from "../../navigation";
import { PeoplePage } from "./people-page";

export const metadata: Metadata = {
  title: "People - Blink",
  description:
    "Manage your organization members, invite new members, and control access permissions.",
};

export default async function Page({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const session = await auth();
  if (!session || !session.user) {
    redirect("/login");
  }

  const { organization: organizationName } = await params;
  const [organization, user] = await Promise.all([
    getOrganization(session.user.id, organizationName),
    getUser(session.user.id),
  ]);

  const isAdmin =
    organization.membership?.role === "admin" ||
    organization.membership?.role === "owner";
  const isPersonal = organization.id === user.organization_id;

  return (
    <div className="w-full relative">
      <Header
        user={user}
        organization={organization}
        enableMultiOrg={getEnableMultiOrg()}
      />
      <OrganizationNavigation
        name={organization.name}
        isPersonal={isPersonal}
        isSiteAdmin={user.site_role === "admin"}
      />

      <PageContainer>
        <PageHeader
          title="People"
          description="Manage your organization members and their roles."
        />
        <PeoplePage
          organizationId={organization.id}
          username={user.username}
          isAdmin={isAdmin}
          viewerUserId={session.user.id}
          enableMultiOrg={getEnableMultiOrg()}
        />
      </PageContainer>
    </div>
  );
}
