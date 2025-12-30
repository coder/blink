"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Client from "@blink.so/api";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface UserEmailFormProps {
  userId: string;
  currentEmail: string;
}

export function UserEmailForm({ userId, currentEmail }: UserEmailFormProps) {
  const [step, setStep] = useState<"request" | "verify">("request");
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isRequestSubmitting, setIsRequestSubmitting] = useState(false);
  const [isVerifySubmitting, setIsVerifySubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const router = useRouter();

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError(null);
    setIsRequestSubmitting(true);

    try {
      const client = new Client();
      await client.auth.requestEmailChange({ currentPassword, newEmail });
      setStep("verify");
      toast.success(`Verification code sent to ${newEmail}`);
      setCurrentPassword("");
    } catch (err) {
      console.error("Email change request error:", err);
      setRequestError(
        err instanceof Error ? err.message : "Failed to request email change"
      );
    } finally {
      setIsRequestSubmitting(false);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    setIsVerifySubmitting(true);

    try {
      const client = new Client();
      await client.auth.verifyEmailChange({ code });
      toast.success("Email updated successfully");
      setStep("request");
      setNewEmail("");
      setCode("");
      router.refresh();
    } catch (err) {
      console.error("Email verification error:", err);
      setVerifyError(
        err instanceof Error ? err.message : "Failed to verify email change"
      );
    } finally {
      setIsVerifySubmitting(false);
    }
  };

  const handleResendCode = async () => {
    setIsResending(true);
    try {
      // Re-request the email change to get a new code
      const client = new Client();
      await client.auth.requestEmailChange({ currentPassword, newEmail });
      toast.success("Verification code resent");
    } catch (err) {
      toast.error("Failed to resend code");
    } finally {
      setIsResending(false);
    }
  };

  const handleCancel = () => {
    setStep("request");
    setNewEmail("");
    setCurrentPassword("");
    setCode("");
    setRequestError(null);
    setVerifyError(null);
  };

  if (step === "verify") {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-medium">Verify New Email</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Enter the verification code sent to {newEmail}
          </p>
        </div>

        <form onSubmit={handleVerifySubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="code"
              className="text-sm font-medium text-foreground"
            >
              Verification Code
            </label>
            <Input
              id="code"
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter 8-digit code"
              required
              autoFocus
              disabled={isVerifySubmitting}
            />
            {verifyError && (
              <p className="text-sm text-destructive">{verifyError}</p>
            )}
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={isVerifySubmitting || !code}>
              {isVerifySubmitting ? "Verifying..." : "Verify Email"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleResendCode}
              disabled={isResending}
            >
              {isResending ? "Sending..." : "Resend Code"}
            </Button>
            <Button type="button" variant="ghost" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-medium">Change Email</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Update your email address. You'll need to verify the new email.
        </p>
      </div>

      <form onSubmit={handleRequestSubmit} className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="current_email"
            className="text-sm font-medium text-foreground"
          >
            Current Email
          </label>
          <Input
            id="current_email"
            value={currentEmail}
            disabled
            className="bg-muted"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="newEmail"
            className="text-sm font-medium text-foreground"
          >
            New Email
          </label>
          <Input
            id="newEmail"
            name="newEmail"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value.toLowerCase())}
            placeholder="Enter new email address"
            required
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="currentPassword"
            className="text-sm font-medium text-foreground"
          >
            Current Password
          </label>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter your current password"
            required
          />
          <p className="text-sm text-muted-foreground">
            Required to verify your identity
          </p>
          {requestError && (
            <p className="text-sm text-destructive">{requestError}</p>
          )}
        </div>

        <Button
          type="submit"
          disabled={isRequestSubmitting || !newEmail || !currentPassword}
        >
          {isRequestSubmitting ? "Sending Code..." : "Send Verification Code"}
        </Button>
      </form>
    </div>
  );
}
