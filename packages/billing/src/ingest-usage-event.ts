// OSS stub: Billing removed
import type { EnvLike } from "./metronome";
import type { Money } from "./money";

export interface UsageEvent {
  organizationId: string;
  costUSD: Money;
  transactionId: string;
  eventType: string;
  userID: string | null;
  timestamp?: Date;
}

export async function ingestUsageEvent(
  env: EnvLike,
  querier: any,
  event: UsageEvent
): Promise<void> {
  // No-op in OSS version
}
