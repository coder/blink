import { auth } from "@/app/(auth)/auth";
import Header from "@/components/header";
import { getEnableMultiOrg } from "@/lib/multi-org";
import { redirect } from "next/navigation";
import { getOrganization, getUser } from "../../layout";
import { OrganizationNavigation } from "../../navigation";
import { OrganizationSettingsNav } from "./navigation";

export default async function OrganizationSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organization: string }>;
}) {
  const session = await auth();
  if (!session || !session.user?.id) {
    redirect("/");
  }

  const { organization: organizationName } = await params;
  const [organization, user] = await Promise.all([
    getOrganization(session.user.id, organizationName),
    getUser(session.user.id),
  ]);

  const isPersonalOrg = organization.id === user.organization_id;

  return (
    <div className="w-full relative">
      <Header
        user={user}
        organization={organization}
        enableMultiOrg={getEnableMultiOrg()}
      />
      <OrganizationNavigation
        name={organization.name}
        isPersonal={isPersonalOrg}
        isSiteAdmin={user.site_role === "admin"}
      />
      <div className="w-full p-8 max-w-6xl mx-auto space-y-6">
        <OrganizationSettingsNav
          organizationName={organization.name}
          isPersonalOrg={isPersonalOrg}
        />
        {children}
      </div>
    </div>
  );
}
