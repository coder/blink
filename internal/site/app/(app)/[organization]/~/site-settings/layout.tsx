import { notFound, redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import Header from "@/components/header";
import { getEnableMultiOrg } from "@/lib/multi-org";
import { getOrganization, getUser } from "../../layout";
import { OrganizationNavigation } from "../../navigation";
import { SiteAdminNav } from "./navigation";

export default async function SiteAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organization: string }>;
}) {
  const session = await auth();
  if (!session || !session.user?.id) {
    redirect("/login");
  }

  const { organization: organizationName } = await params;
  const [organization, user] = await Promise.all([
    getOrganization(session.user.id, organizationName),
    getUser(session.user.id),
  ]);

  const isPersonal = organization.id === user.organization_id;

  // Only site admins can access this page
  if (user.site_role !== "admin") {
    notFound();
  }

  // This page is only accessible from personal organization
  if (!isPersonal) {
    notFound();
  }

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
        isSiteAdmin
      />
      <div className="w-full p-8 max-w-6xl mx-auto space-y-6">
        <SiteAdminNav organizationName={organization.name} />
        {children}
      </div>
    </div>
  );
}
