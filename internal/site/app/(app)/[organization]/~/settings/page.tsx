import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/app/(auth)/auth";
import { getQuerier } from "@/lib/database";
import { getEmailDeliveryConfigured } from "@/lib/email-delivery";
import { getEnableMultiOrg } from "@/lib/multi-org";
import { getOrganization, getUser } from "../../layout";
import { DeleteOrganizationForm } from "./organization-delete-form";
import { OrganizationIdSection } from "./organization-id-section";
import { OrganizationProfileForm } from "./organization-profile-form";
import UserAuthentication from "./user-authentication";
import { DeleteUserForm } from "./user-delete-form";
import { UserEmailForm } from "./user-email-form";
import { UserIdSection } from "./user-id-section";
import { UserProfileForm } from "./user-profile-form";

export const metadata: Metadata = {
  title: "Settings - Blink",
  description: "Manage your settings and preferences.",
};

export default async function OrganizationSettingsPage({
  params,
}: {
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

  if (isPersonalOrg) {
    // For personal organizations, show user settings
    const querier = await getQuerier();
    const fullUser = await querier.selectUserByID(session.user.id);

    if (!fullUser) {
      redirect("/");
    }

    const emailDeliveryConfigured = getEmailDeliveryConfigured();

    return (
      <div className="space-y-8">
        <UserProfileForm
          user={{
            id: fullUser.id,
            display_name: fullUser.display_name,
            email: fullUser.email,
            username: fullUser.username,
            organization_id: fullUser.organization_id,
          }}
        />
        {emailDeliveryConfigured && (
          <UserEmailForm
            userId={fullUser.id}
            currentEmail={fullUser.email || ""}
          />
        )}
        <UserAuthentication />
        <UserIdSection userId={fullUser.id} />
        <DeleteUserForm userEmail={fullUser.email} />
      </div>
    );
  }

  // For team organizations, show organization settings
  const isAdmin =
    organization.membership?.role === "admin" ||
    organization.membership?.role === "owner";
  const enableMultiOrg = getEnableMultiOrg();

  return (
    <div className="space-y-8">
      <OrganizationProfileForm
        organization={{
          id: organization.id,
          name: organization.name,
          avatar_url: organization.avatar_url,
        }}
        isAdmin={isAdmin}
      />
      <OrganizationIdSection organizationId={organization.id} />
      {isAdmin && enableMultiOrg && (
        <DeleteOrganizationForm
          organizationId={organization.id}
          organizationName={organization.name}
        />
      )}
    </div>
  );
}
