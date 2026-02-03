import { auth } from "@/app/(auth)/auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isOauthEnabled } from "@/lib/auth-providers";
import { getQuerier } from "@/lib/database";
import { UserAuthenticationClient } from "./user-authentication-client";

export default async function UserAuthentication() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const querier = await getQuerier();
  const [gh, gg, user] = await Promise.all([
    querier.selectUserAccountsByProviderAndUserID("github", session.user.id),
    querier.selectUserAccountsByProviderAndUserID("google", session.user.id),
    querier.selectUserByID(session.user.id),
  ]);
  const oauthEnabled = await isOauthEnabled();

  if (!user) return null;

  // Get personal organization name for redirect
  const personalOrg = await querier.selectOrganizationForUser({
    organizationID: user.organization_id,
    userID: user.id,
  });

  if (!personalOrg) return null;

  return (
    <section className="space-y-6">
      <div>
        <div className="text-sm font-medium">Authentication</div>
        <p className="text-sm text-muted-foreground">
          Configure how you sign in to Blink.
        </p>
      </div>

      <TooltipProvider delayDuration={0}>
        <UserAuthenticationClient
          githubAccounts={gh}
          googleAccounts={gg}
          hasPassword={Boolean(user.password)}
          personalOrgName={personalOrg.name}
          oauthEnabled={oauthEnabled}
        />
      </TooltipProvider>
    </section>
  );
}
