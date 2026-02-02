import type Querier from "@blink.so/database/querier";
import { fn } from "storybook/test";

// Helpers for generating simple mock usage data
const makeDaily = (days: number) => {
  const out: Array<{
    date: string;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    cached_tokens: number;
    message_count: number;
    daily_cost: number;
  }> = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    // Create staggered pattern: higher on even days, lower on odd days
    const baseUsage = 3000;
    const variation = i % 2 === 0 ? 1.8 : 0.6; // High/low alternating pattern
    const randomFactor = 0.8 + Math.sin(i * 0.3) * 0.4; // Add some wave variation
    const total = Math.floor(baseUsage * variation * randomFactor);
    const prompt = Math.floor(total * 0.65);
    const completion = total - prompt;
    const cached = i % 4 === 0 ? Math.floor(total * 0.12) : 0;
    const messages = Math.floor(8 + total / 400); // Scale messages with usage
    const cost = +(total * 0.000005).toFixed(4);
    out.push({
      date: d.toISOString().slice(0, 10),
      total_tokens: total,
      prompt_tokens: prompt,
      completion_tokens: completion,
      cached_tokens: cached,
      message_count: messages,
      daily_cost: cost,
    });
  }
  return out;
};

const daily = makeDaily(30);

export const getQuerier = fn(
  async (): Promise<Partial<Querier>> => ({
    selectOrganizationForUser: fn(async () => ({
      id: "1",
      name: "Test Organization",
      avatar_url: "https://test.com/image.png",
      created_at: new Date(),
      updated_at: new Date(),
      created_by: "1",
      kind: "organization" as const,
      personal_owner_user_id: null,
      billing_tier: "free" as const,
      billing_interval: "month" as const,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      metronome_customer_id: null,
      metronome_contract_id: null,
      next_billing_date: null,
      custom_instructions: null,
      owner_id: "1",
      billing_entitled_at: new Date(),
      membership: {
        created_at: new Date(),
        updated_at: new Date(),
        organization_id: "1",
        user_id: "1",
        role: "owner" as const,
        billing_emails_opt_out: false,
      },
    })),

    selectAgentsByOrganizationID: fn(
      async (_params: { organizationID: string; userID: string }) => ({
        items: [],
        has_more: false,
      })
    ),

    selectOrganizationMembers: fn(async () => ({
      items: [],
      has_more: false,
    })),

    selectAgentIntervalStats: async () => [],

    selectUserByID: fn(async () => ({
      id: "1",
      display_name: "Test User",
      email: "test@test.com",
      email_verified: new Date(),
      avatar_url: "https://test.com/image.png",
      password: "password",
      created_at: new Date(),
      updated_at: new Date(),
      username: "test",
      organization_id: "1",
      site_role: "member" as const,
      suspended: false,
    })),
    selectOrganizationMembersWithUserInfoByOrganizationID: fn(async () => []),
    selectOrganizationInvitesByOrganizationID: fn(async () => []),
    selectUserAccountsByProviderAndUserID: fn(async () => []),
    selectOrganizationInviteWithOrganizationByToken: fn(async () => undefined),

    selectOrganizationByID: fn(async () => ({
      id: "1",
      name: "Test Team",
      username: "test-team",
      avatar_url: null,
      created_at: new Date(),
      updated_at: new Date(),
      invite_code: "1",
      created_by: "1",
      owner_id: "1",
      kind: "organization" as const,
      personal_owner_user_id: null,
      billing_tier: "team" as const,
      billing_interval: "month" as const,
      stripe_customer_id: "cus_test123",
      stripe_subscription_id: "sub_test123",
      metronome_customer_id: null,
      metronome_contract_id: null,
      next_billing_date: new Date(),
      billing_entitled_at: new Date(),
    })),
  })
);
