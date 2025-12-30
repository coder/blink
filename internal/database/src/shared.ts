// Shared constants that are used on the client and server.

export const username_format = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/;

// Reserved usernames that cannot be used for organizations or personal accounts.
// These protect important routes and prevent phishing attempts.
export const reserved_usernames = new Set([
  // System routes
  "api",
  "auth",
  "login",
  "logout",
  "signup",
  "register",
  "help",
  "docs",
  "support",
  "contact",
  "about",
  "blog",

  // App routes
  "chat",
  "agents",
  "agent",
  "shortcuts",
  "integrations",
  "user",
  "team",
  "new",
  "recent-chats",
  "telemetry",

  // Settings/account
  "settings",
  "account",
  "profile",
  "billing",
  "admin",
  "dashboard",

  // Legal
  "privacy",
  "terms",
  "tos",
  "legal",
  "security",

  // Technical
  "internal",
  "webhook",
  "webhooks",
  "callback",
  "verify",
  "metrics",
  "status",
  "health",
]);

// Compute expiration date from created_at + expire_ttl (in seconds)
// Returns null if expire_ttl is null (chat never expires)
export function computeExpiresAt(
  expireTtl: number | null,
  createdAt: Date
): Date | null {
  if (expireTtl === null) {
    return null;
  }

  return new Date(createdAt.getTime() + expireTtl * 1000);
}
