import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPublicSignupStatus } from "@/lib/signups";
import { LoginForm } from "./form";

export const metadata: Metadata = {
  title: "Login - Blink",
  description:
    "Sign in to Blink to start chatting with your AI engineering assistant.",
};

interface LoginPageProps {
  searchParams: Promise<{
    error?: string;
    waitlist?: string;
    callbackUrl?: string;
    redirect?: string;
    reset?: string;
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { isFirstUser, enableSignups } = await getPublicSignupStatus();
  if (isFirstUser) {
    redirect("/setup");
  }

  const {
    error,
    waitlist,
    redirect: redirectTarget,
    reset,
  } = await searchParams;
  const friendlyError = mapErrorToMessage(error);
  const showResetSuccess = reset === "1";
  const redirectQuery = redirectTarget
    ? `?redirect=${encodeURIComponent(redirectTarget)}`
    : "";
  const lastProvider = (await cookies()).get("last_login_provider")?.value as
    | "credentials"
    | "github"
    | "google"
    | undefined;
  return (
    <div className="flex items-center justify-center p-4">
      <div
        className={`w-full ${waitlist !== undefined ? "max-w-lg" : "max-w-md"}`}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white mb-2">
            {waitlist !== undefined ? "Join the waitlist" : "Log in to Blink"}
          </h1>
          {waitlist !== undefined && (
            <p className="text-lg text-zinc-600 dark:text-zinc-400 max-w-xl mx-auto">
              Want to use Blink in Slack and your browser?
              <br />
              Join the waitlist to be first in line.
            </p>
          )}
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-lg p-8">
          <div className="space-y-4">
            {/* Success Display */}
            {showResetSuccess && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <p className="text-sm text-green-800 dark:text-green-200">
                  Password successfully reset! You can now sign in with your new
                  password.
                </p>
              </div>
            )}

            {/* Error Display */}
            {friendlyError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                <p className="text-sm text-red-800 dark:text-red-200">
                  {friendlyError}
                </p>
              </div>
            )}

            {/* GitHub Sign In */}
            <Link
              href={`/api/auth/signin/github${redirectTarget ? `?redirect=${encodeURIComponent(redirectTarget)}` : ""}`}
            >
              <Button
                variant="outline"
                size="lg"
                className="w-full h-12 text-base font-medium group"
              >
                <div className="flex items-center justify-center gap-3">
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 0C5.374 0 0 5.373 0 12 0 17.302 3.438 21.8 8.207 23.387c.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                  </svg>
                  <span>Continue with GitHub</span>
                  {lastProvider === "github" ? (
                    <Badge variant="secondary" className="ml-2">
                      Last
                    </Badge>
                  ) : null}
                </div>
              </Button>
            </Link>

            {/* Google Sign In */}
            <Link
              href={`/api/auth/signin/google${redirectTarget ? `?redirect=${encodeURIComponent(redirectTarget)}` : ""}`}
            >
              <Button
                variant="outline"
                size="lg"
                className="w-full h-12 text-base font-medium group"
              >
                <div className="flex items-center justify-center gap-3">
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span>Continue with Google</span>
                  {lastProvider === "google" ? (
                    <Badge variant="secondary" className="ml-2">
                      Last
                    </Badge>
                  ) : null}
                </div>
              </Button>
            </Link>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-300 dark:border-zinc-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-zinc-900 text-neutral-500">
                  Or sign in with email
                </span>
              </div>
            </div>

            {/* Email/Password Sign In */}
            <LoginForm redirect={redirectTarget} lastProvider={lastProvider} />
          </div>

          {/* Footer */}
          {enableSignups && (
            <div className="mt-6 text-center">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Don't have an account?{" "}
                <a
                  href={`/signup${redirectQuery}`}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Sign up
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Terms */}
        {/* <div className="mt-6 text-center">
          <p className="text-xs text-neutral-500">
            By signing in, you agree to our{" "}
            <a href="/terms" className="hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="/privacy" className="hover:underline">
              Privacy Policy
            </a>
          </p>
        </div> */}
      </div>
    </div>
  );
}

function mapErrorToMessage(
  code?: string,
  provider?: string
): string | undefined {
  if (!code) return undefined;
  switch (code) {
    case "OAuthAccountNotLinked":
      return `This ${provider ?? "OAuth"} account is already linked to another Blink account. Try a different account or unlink it from the other account first.`;
    case "AccessDenied":
      return "Access was denied. Please try again.";
    case "Configuration":
      return "Sign-in is temporarily unavailable. Please try again later.";
    case "Verification":
      return "The verification link is invalid or has expired.";
    case "signups_disabled":
      return "Signups are disabled on this instance. Contact your administrator.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
