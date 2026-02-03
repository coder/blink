import type {
  Organization,
  OrganizationMembership,
} from "@blink.so/database/schema";
import { fn } from "storybook/test";
import type { Session } from "next-auth";

export const auth = fn(async (): Promise<Session | null> => {
  return {
    user: {
      id: "1",
    },
    expires: new Date().toISOString(),
  };
});

export const fakeTeam: Organization = {
  id: "1",
  avatar_url: null,
  created_at: new Date(),
  name: "test-team",
  created_by: "1",
  kind: "organization",
  personal_owner_user_id: null,
  updated_at: new Date(),
  billing_tier: "team",
  billing_interval: "month",
  stripe_customer_id: "1",
  stripe_subscription_id: "1",
  next_billing_date: new Date(),
  metronome_customer_id: null,
  metronome_contract_id: null,
  billing_entitled_at: new Date(),
};

export const fakeOrganizationMembershipAdmin: OrganizationMembership = {
  role: "admin",
  created_at: new Date(),
  organization_id: fakeTeam.id,
  user_id: "1",
  billing_emails_opt_out: false,
  updated_at: new Date(),
};

export const fakeOrganizationMembershipMember: OrganizationMembership = {
  role: "member",
  created_at: new Date(),
  organization_id: fakeTeam.id,
  user_id: "1",
  billing_emails_opt_out: false,
  updated_at: new Date(),
};

export const signIn = fn(async (provider: string, options: any) => {
  if (provider === "credentials") {
    return {
      redirect: "/dashboard",
    };
  }
});

export const signOut = fn();

export const decodeEmailVerificationToken = fn(() => ({
  email: "test@test.com",
}));

export const generateEmailVerificationToken = fn(() => ({
  code: "12345678",
  token: "fake-token",
}));

export const emailVerificationTokenCookieName = "fake";

export class EmailNotVerifiedError {}

export class InvalidCredentialsError {}

export const passwordResetVerifiedCookieName = "fake-reset-verified";

export const decodePasswordResetVerifiedToken = fn(() => ({
  email: "test@test.com",
}));

export const generatePasswordResetVerifiedToken = fn(
  () => "fake-reset-verified-token"
);

export const getSessionToken = fn(() => "fake-session-token");
