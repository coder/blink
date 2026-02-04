import { getEmailDeliveryConfigured } from "@/lib/email-delivery";
import ResetPasswordForm from "./form";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  const isEmailConfigured = getEmailDeliveryConfigured();

  if (!isEmailConfigured) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white mb-2">
            Contact this instance's admin to reset your password
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Remember your password?{" "}
            <a
              href="/login"
              className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white mb-2">
            Reset your password
          </h1>
          <p className="text-neutral-600 dark:text-neutral-400">
            Enter your email address and we'll send you a link to reset your
            password
          </p>
        </div>

        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-lg p-8">
          <ResetPasswordForm />

          <div className="mt-6 text-center">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Remember your password?{" "}
              <a
                href="/login"
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                Sign in
              </a>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-neutral-500">
            Need help? Contact our{" "}
            <a
              href="mailto:support@blink.coder.com"
              className="hover:underline"
            >
              support team
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
