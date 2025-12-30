import { auth } from "@/app/(auth)/auth";
import { LogoBlink } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { getQuerier } from "@/lib/database";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AcceptInviteButton } from "./accept-invite-button";

export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const { token } = await params;
  const querier = await getQuerier();
  const inviteData = await querier.selectOrganizationInviteByCode(token);

  if (!inviteData) {
    return {
      title: "Invalid Invite - Blink",
      description: "This organization invitation is invalid or has expired.",
    };
  }

  return {
    title: `Join ${inviteData.organization.name} - Blink`,
    description: `You've been invited to join ${inviteData.organization.name} on Blink.`,
  };
}

interface InvitePageProps {
  params: {
    token: string;
  };
  searchParams: Promise<{
    redirect?: string;
  }>;
}

export default async function InvitePage({
  params,
  searchParams,
}: InvitePageProps) {
  const { token } = await params;
  const session = await auth();
  const queryParams = await searchParams;

  const querier = await getQuerier();
  const inviteData = await querier.selectOrganizationInviteByCode(token);

  if (!inviteData) {
    notFound();
  }

  const { invite, organization } = inviteData;

  // Check if invite is expired
  if (invite.expires_at && new Date() > invite.expires_at) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 bg-[radial-gradient(ellipse_at_top,rgba(120,119,198,0.08),transparent_50%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(120,119,198,0.12),transparent_50%)] p-6">
        <div className="w/full max-w-md">
          <div className="flex justify-center mb-6">
            <LogoBlink size={20} className="invert dark:invert-0" />
          </div>
          <div className="bg-white/95 dark:bg-neutral-900/80 backdrop-blur rounded-2xl border border-neutral-200/70 dark:border-neutral-800/70 shadow-[0_2px_20px_rgba(0,0,0,0.08)] p-8 text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/40 mb-4">
              <svg
                className="h-6 w-6 text-red-600 dark:text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-2">
              Invite Expired
            </h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              This invitation link has expired. Please request a new invitation
              from a team admin.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Check if single-use invite was already used
  if (!invite.reusable && invite.last_accepted_at) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 bg-[radial-gradient(ellipse_at_top,rgba(120,119,198,0.08),transparent_50%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(120,119,198,0.12),transparent_50%)] p-6">
        <div className="w/full max-w-md">
          <div className="flex justify-center mb-6">
            <LogoBlink size={20} className="invert dark:invert-0" />
          </div>
          <div className="bg-white/95 dark:bg-neutral-900/80 backdrop-blur rounded-2xl border border-neutral-200/70 dark:border-neutral-800/70 shadow-[0_2px_20px_rgba(0,0,0,0.08)] p-8 text-center">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-yellow-100 dark:bg-yellow-900/40 mb-4">
              <svg
                className="h-6 w-6 text-yellow-600 dark:text-yellow-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-neutral-900 dark:text-white mb-2">
              Invite Already Used
            </h2>
            <p className="text-neutral-600 dark:text-neutral-400">
              This invitation link has already been used. Please request a new
              invitation from a team admin.
            </p>
          </div>
        </div>
      </div>
    );
  }

  let redirectTo = queryParams.redirect || `/${organization.name}`;
  if (redirectTo) {
    try {
      new URL(redirectTo);
      // If the URL parses properly, the redirect is to another domain.
      redirectTo = `/${organization.name}`;
    } catch (err) {
      // Keep the provided relative path as-is
    }
  }

  // If user is authenticated, check if they're already a member
  if (session?.user?.id) {
    const existingMembership = await querier.selectOrganizationMembership({
      userID: session.user.id,
      organizationID: organization.id,
    });
    if (existingMembership) {
      redirect(redirectTo);
    }
  }

  const inviteUrl = `/invite/${encodeURIComponent(token)}`;
  const redirectParam = redirectTo
    ? `?redirect=${encodeURIComponent(redirectTo)}`
    : "";
  const loginHref = `/login?redirect=${encodeURIComponent(
    `${inviteUrl}${redirectParam}`
  )}`;
  const signupHref = `/signup?redirect=${encodeURIComponent(
    `${inviteUrl}${redirectParam}`
  )}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 bg-[radial-gradient(ellipse_at_top,rgba(120,119,198,0.08),transparent_50%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(120,119,198,0.12),transparent_50%)] p-6">
      <div className="w/full max-w-md">
        <div className="flex justify-center mb-6">
          <LogoBlink size={20} className="invert dark:invert-0" />
        </div>
        <div className="bg-white/95 dark:bg-neutral-900/80 backdrop-blur rounded-2xl border border-neutral-200/70 dark:border-neutral-800/70 shadow-[0_2px_20px_rgba(0,0,0,0.08)] p-8">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">
              Join {organization.name}
            </h1>
            <p className="text-neutral-600 dark:text-neutral-400">
              You have been invited to join this organization
              {invite.email && (
                <span>
                  {" "}
                  as <strong>{invite.email}</strong>
                </span>
              )}
            </p>
          </div>

          {session?.user?.id ? (
            <AcceptInviteButton
              inviteId={invite.id}
              code={token}
              redirect={redirectTo}
            />
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-400 text-center">
                Sign up to accept this invitation
              </p>
              <Button asChild variant="default" size="lg" className="w-full">
                <a href={signupHref} data-testid="invite-signup-link">
                  Sign up
                </a>
              </Button>
              <div className="text-center">
                <a
                  href={loginHref}
                  data-testid="invite-login-link"
                  className="text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 underline transition-colors"
                >
                  I am already a Blink user
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
