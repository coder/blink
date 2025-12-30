import { auth } from "@/app/(auth)/auth";
import { getQuerier } from "@/lib/database";
import { redirect } from "next/navigation";

export default async function ProfilePage() {
  const session = await auth();

  if (!session || !session.user) {
    redirect("/");
  }

  // Fetch user's personal organization and redirect to it
  const querier = await getQuerier();
  const user = await querier.selectUserByID(session.user.id);

  if (!user) {
    redirect("/");
  }

  // Get the personal organization by user's organization_id
  const personalOrganization = await querier.selectOrganizationForUser({
    organizationID: user.organization_id,
    userID: user.id,
  });

  if (!personalOrganization) {
    redirect("/");
  }

  // Redirect to personal organization settings
  redirect(`/${personalOrganization.name}/~/settings`);
}
