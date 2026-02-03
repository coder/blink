import type { User, UserAccount } from "@blink.so/database/schema";
import { compare } from "bcrypt-ts";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { validator } from "hono/validator";
import { decode, encode } from "next-auth/jwt";
import { z } from "zod";
import { withAuth } from "../../middleware";
import type { APIServer, Bindings } from "../../server";
import { hashPassword } from "../../util/password";
import { provisionUser } from "../provision-user";
import {
  schemaRequestEmailChangeRequest,
  schemaRequestPasswordResetRequest,
  schemaResetPasswordRequest,
  schemaSignInWithCredentialsRequest,
  schemaSignupRequest,
  schemaVerifyEmailChangeRequest,
  schemaVerifyEmailRequest,
  SESSION_COOKIE_NAME,
  SESSION_SECURE,
} from "./auth.client";

// ============================================================================
// Providers
// ============================================================================

const providers = {
  credentials: {
    id: "credentials",
    name: "Credentials",
    type: "credentials" as const,
  },
  github: {
    id: "github",
    name: "GitHub",
    type: "oauth" as const,
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    scope: "user:email",
  },
  google: {
    id: "google",
    name: "Google",
    type: "oauth" as const,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    scope: "openid email profile",
  },
};

// ============================================================================
// Helpers
// ============================================================================

const INVITE_COOKIE = "blink_invite_verified";
type Database = Awaited<ReturnType<Bindings["database"]>>;

const isPublicSignupAllowed = async (
  c: Context<{ Bindings: Bindings }>,
  db: Database
) => {
  if (c.env.enableSignups) {
    return true;
  }

  const teamOrgs = await db.selectTeamOrganizations();
  if (teamOrgs.length > 0) {
    return false;
  }

  const users = await db.selectAllUsers({ page: 1, per_page: 1 });
  return users.items.length === 0;
};

// ============================================================================
// OAuth
// ============================================================================

async function initiateOAuthFlow(
  c: Context<{ Bindings: Bindings }>,
  provider: "github" | "google"
) {
  const config = providers[provider];
  const callbackUrl = new URL(
    `/api/auth/callback/${provider}`,
    c.env.apiBaseURL
  );

  // Generate state with encoded redirect info
  const state = await encode({
    secret: c.env.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider,
      nonce: crypto.randomUUID(),
      callbackUrl: callbackUrl.toString(),
    },
  });

  const authUrl = new URL(config.authUrl);
  const clientId =
    provider === "github" ? c.env.GITHUB_CLIENT_ID : c.env.GOOGLE_CLIENT_ID;

  authUrl.searchParams.set("client_id", clientId!);
  authUrl.searchParams.set("redirect_uri", callbackUrl.toString());
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("response_type", "code");

  if (provider === "google") {
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
  }

  return c.redirect(authUrl.toString());
}

async function handleOAuthCallback(
  c: Context<{ Bindings: Bindings }>,
  provider: "github" | "google"
) {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.redirect("/login?error=missing_params");
  }

  // Verify state
  try {
    const decoded = await decode({
      token: state,
      secret: c.env.AUTH_SECRET,
      salt: "oauth-state",
    });

    if (!decoded || decoded.provider !== provider) {
      return c.redirect("/login?error=invalid_state");
    }
  } catch {
    return c.redirect("/login?error=invalid_state");
  }

  const config = providers[provider];
  const callbackUrl = new URL(
    `/api/auth/callback/${provider}`,
    c.env.apiBaseURL
  );

  const clientId =
    provider === "github" ? c.env.GITHUB_CLIENT_ID : c.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    provider === "github"
      ? c.env.GITHUB_CLIENT_SECRET
      : c.env.GOOGLE_CLIENT_SECRET;

  // Exchange code for token
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl.toString(),
      grant_type: "authorization_code",
    }),
  });

  const tokenData = (await tokenResponse.json()) as any;
  const accessToken = tokenData.access_token;

  if (!accessToken) {
    return c.redirect("/login?error=no_access_token");
  }

  // Fetch user profile
  const userResponse = await fetch(config.userUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "Blink (https://blink.coder.com)",
    },
  });

  if (!userResponse.ok) {
    const responseText = await userResponse.text();
    console.error("Failed to fetch user profile", responseText);
    return c.redirect("/login?error=failed_to_fetch_user_profile");
  }

  const profile = (await userResponse.json()) as any;

  // Map profile to user
  const userProfile =
    provider === "github"
      ? {
          id: profile.id.toString(),
          email: profile.email,
          name: profile.name || profile.login,
          image: profile.avatar_url,
        }
      : {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          image: profile.picture,
        };

  const db = await c.env.database();
  const inviteCookie = getCookie(c, INVITE_COOKIE);

  // Check if user is already authenticated (for account linking)
  const existingSessionToken = getCookie(c, SESSION_COOKIE_NAME);
  let authenticatedUserId: string | null = null;

  if (existingSessionToken) {
    try {
      const decoded = await decode({
        token: existingSessionToken,
        secret: c.env.AUTH_SECRET,
        salt: SESSION_COOKIE_NAME,
      });
      if (decoded?.id) {
        authenticatedUserId = decoded.id as string;
      }
    } catch {
      // Invalid token, ignore
    }
  }

  // Get or create user
  const existingAccount = await db.selectUserAccountByProviderAccountID(
    provider as UserAccount["provider"],
    userProfile.id
  );

  let user: User;
  let isLinking = false;

  if (existingAccount?.user) {
    user = existingAccount.user;
  } else if (authenticatedUserId) {
    isLinking = true;
    // User is already logged in - link this provider to their account
    const existingUser = await db.selectUserByID(authenticatedUserId);
    if (!existingUser) {
      return c.redirect("/login?error=invalid_session");
    }

    // Check if this provider account is already linked to a different user
    const conflictingAccount = await db.selectUserAccountByProviderAccountID(
      provider as UserAccount["provider"],
      userProfile.id
    );
    if (
      conflictingAccount &&
      conflictingAccount.user.id !== authenticatedUserId
    ) {
      return c.redirect(
        "/login?error=provider_already_linked&provider=" + provider
      );
    }

    // Link the provider account to the existing user
    await db.upsertUserAccount({
      user_id: authenticatedUserId,
      type: "oauth",
      provider: provider as UserAccount["provider"],
      provider_account_id: userProfile.id,
      access_token: accessToken,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : null,
      token_type: tokenData.token_type ?? null,
      scope: tokenData.scope ?? null,
      id_token: null,
      session_state: "",
    });

    user = existingUser;
  } else {
    // Check if email is already in use by another account
    if (userProfile.email) {
      const existingUserByEmail = await db.selectUserByEmail(userProfile.email);
      if (existingUserByEmail) {
        return c.redirect(
          "/login?error=email_already_in_use&email=" +
            encodeURIComponent(userProfile.email)
        );
      }
    }

    if (!(await isPublicSignupAllowed(c, db))) {
      return c.redirect("/login?error=signups_disabled");
    }

    // Create new user
    let usedInviteId: string | null = null;

    if (inviteCookie) {
      // marker is the invite token itself, re-validate before using
      const inviteData =
        await db.selectOrganizationInviteWithOrganizationByToken(inviteCookie);
      if (inviteData) {
        const invite = inviteData.organization_invite;
        if (
          !(invite.expires_at && new Date() > invite.expires_at) &&
          (invite.reusable || !invite.last_accepted_at)
        ) {
          usedInviteId = invite.id;
        }
      }
    }

    user = await provisionUser({
      db,
      autoJoinOrganizations: c.env.autoJoinOrganizations,
      user: {
        email: userProfile.email ?? null,
        email_verified: new Date(),
        display_name: userProfile.name ?? null,
        password: null,
      },
    });

    // consume single-use invite (mark accepted)
    if (usedInviteId) {
      try {
        await db.updateOrganizationInviteLastAcceptedAtByID(usedInviteId);
      } catch {}
    }

    // Link account
    await db.upsertUserAccount({
      user_id: user.id,
      type: "oauth",
      provider: provider as UserAccount["provider"],
      provider_account_id: userProfile.id,
      access_token: accessToken,
      refresh_token: tokenData.refresh_token ?? null,
      expires_at: tokenData.expires_in
        ? Math.floor(Date.now() / 1000) + tokenData.expires_in
        : null,
      token_type: tokenData.token_type ?? null,
      scope: tokenData.scope ?? null,
      id_token: null,
      session_state: "",
    });

    // Sync OAuth user to telemetry system (async, don't block)
    if (c.env.sendTelemetryEvent && user.email) {
      c.env
        .sendTelemetryEvent({
          type: "user.oauth_registered",
          userId: user.id,
          email: user.email,
          name: user.display_name,
          provider: provider,
        })
        .then(() => {
          // Attempt to merge any existing invited user record
          if (user!.email && c.env.sendTelemetryEvent) {
            return c.env.sendTelemetryEvent({
              type: "user.merged",
              primaryUserId: user!.id,
              secondaryUserId: user!.email,
            });
          }
        })
        .catch(() => {
          // Ignore errors to avoid breaking OAuth flow
        });
    }
  }

  if (user.suspended) {
    return c.redirect("/login?error=account_suspended");
  }

  const token = await encode({
    secret: c.env.AUTH_SECRET,
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.display_name,
    },
    salt: SESSION_COOKIE_NAME,
  });

  // Set cookies and redirect using Hono's setCookie helper
  setCookie(c, SESSION_COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: SESSION_SECURE,
    maxAge: 30 * 24 * 60 * 60, // 30 days
  });

  setCookie(c, "last_login_provider", provider, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: SESSION_SECURE,
    maxAge: 60 * 60 * 24 * 180, // 180 days
  });

  // If linking an existing account, redirect back with success message
  if (isLinking) {
    return c.redirect(`/chat?linked=${provider}`);
  }

  return c.redirect("/chat");
}

// ============================================================================
// Routes
// ============================================================================

export default function mountAuth(server: APIServer) {
  // WebSocket token routes (existing functionality)
  server.get("/token", async (c) => {
    console.log("get /token", c.req.header("Connection"));
    if (c.req.header("Connection")?.toLowerCase() !== "upgrade") {
      return c.json(
        {
          message: "Only WebSocket connections are allowed",
        },
        400
      );
    }
    const id = c.req.query("id");
    if (!id) {
      return c.json(
        {
          message: "Missing ID",
        },
        400
      );
    }

    return c.env.auth.handleWebSocketTokenRequest(id, c.req.raw);
  });

  // This is a private undocumented endpoint.
  // Users should not manually request this.
  server.post(
    "/token",
    withAuth,
    validator("json", (value, c) => {
      const schema = z.object({
        id: z.string(),
      });
      return schema.parse(value);
    }),
    async (c) => {
      const userID = c.get("user_id");
      const { id } = c.req.valid("json");
      const token = await encode({
        secret: c.env.AUTH_SECRET,
        token: {
          sub: userID,
        },
        salt: SESSION_COOKIE_NAME,
      });
      await c.env.auth.sendTokenToWebSocket(id, token);
      return c.body(null, 204);
    }
  );

  // NextAuth-compatible routes

  // GET /session - Return current user session
  server.get("/session", async (c) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);

    if (!token) {
      return c.json({});
    }

    try {
      const decoded = await decode({
        token,
        secret: c.env.AUTH_SECRET,
        salt: SESSION_COOKIE_NAME,
      });

      if (!decoded?.id) {
        return c.json({});
      }

      return c.json({
        user: {
          id: decoded.id,
          email: decoded.email,
          name: decoded.name,
          image: decoded.avatar_url || null,
          organization_id: decoded.organization_id,
        },
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    } catch (error) {
      return c.json({});
    }
  });

  // GET /csrf - Return CSRF token
  server.get("/csrf", (c) => {
    return c.json({ csrfToken: crypto.randomUUID() });
  });

  // GET /providers - List available providers
  server.get("/providers", (c) => {
    // Return only public fields (id, name, type) for each provider
    const publicProviders = Object.fromEntries(
      Object.entries(providers).map(([key, provider]) => [
        key,
        {
          id: provider.id,
          name: provider.name,
          type: provider.type,
        },
      ])
    );
    return c.json(publicProviders);
  });

  // POST /signin/credentials - Email/password login
  server.post(
    "/signin/credentials",
    validator("json", (value) => {
      return schemaSignInWithCredentialsRequest.parse(value);
    }),
    async (c) => {
      const { email, password } = c.req.valid("json");
      const db = await c.env.database();

      // Get user
      const user = await db.selectUserByEmail(email);
      if (!user) {
        return c.json({ error: "Invalid credentials" }, 401);
      }

      if (!user.password) {
        return c.json({ error: "Invalid credentials" }, 401);
      }

      // Verify password
      const isValid = await compare(password, user.password);
      if (!isValid) {
        return c.json({ error: "Invalid credentials" }, 401);
      }

      if (user.suspended) {
        return c.json({ error: "Your account has been suspended" }, 403);
      }

      // Check email verified (skip if sendEmail not configured)
      if (c.env.sendEmail && !user.email_verified) {
        return c.json({ error: "Email not verified" }, 401);
      }

      // Generate JWT
      const token = await encode({
        secret: c.env.AUTH_SECRET,
        token: {
          sub: user.id,
          id: user.id,
          email: user.email,
          name: user.display_name,
        },
        salt: SESSION_COOKIE_NAME,
      });

      // Set cookies using Hono's setCookie helper
      setCookie(c, SESSION_COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: SESSION_SECURE,
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });

      setCookie(c, "last_login_provider", "credentials", {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: SESSION_SECURE,
        maxAge: 60 * 60 * 24 * 180, // 180 days
      });

      return c.json({ ok: true, url: "/chat" });
    }
  );

  // POST /verify-email - Verify email with code
  server.post(
    "/verify-email",
    validator("json", (value) => {
      return schemaVerifyEmailRequest.parse(value);
    }),
    async (c) => {
      const { code } = c.req.valid("json");
      const db = await c.env.database();

      // Get token from cookie
      const token = getCookie(c, "email_verification_token");
      if (!token) {
        return c.json({ error: "Session expired" }, 401);
      }

      // Decode the email verification token
      const decoded = await decode({
        secret: c.env.AUTH_SECRET,
        salt: "email-verification",
        token,
      });

      if (!decoded?.email) {
        return c.json({ error: "Invalid token" }, 401);
      }

      // Verify the code
      const emailVerification = await db.selectAndDeleteEmailVerificationByCode(
        {
          email: decoded.email as string,
          code,
        }
      );

      if (!emailVerification) {
        return c.json({ error: "Invalid code" }, 401);
      }

      // Get user
      const user = await db.selectUserByEmail(decoded.email as string);
      if (!user) {
        return c.json({ error: "User not found" }, 404);
      }

      if (user.suspended) {
        return c.json({ error: "Your account has been suspended" }, 403);
      }

      // Mark email as verified
      await db.updateUserByID({
        id: user.id,
        email_verified: new Date(),
      });

      // Generate JWT
      const sessionToken = await encode({
        secret: c.env.AUTH_SECRET,
        token: {
          sub: user.id,
          id: user.id,
          email: user.email,
          name: user.display_name,
        },
        salt: SESSION_COOKIE_NAME,
      });

      // Set cookies using Hono's setCookie helper
      setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: SESSION_SECURE,
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });

      setCookie(c, "last_login_provider", "credentials", {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: SESSION_SECURE,
        maxAge: 60 * 60 * 24 * 180, // 180 days
      });

      return c.json({ ok: true });
    }
  );

  // GET /signin/github - Initiate GitHub OAuth
  server.get("/signin/github", async (c) => {
    return initiateOAuthFlow(c, "github");
  });

  // GET /signin/google - Initiate Google OAuth
  server.get("/signin/google", async (c) => {
    return initiateOAuthFlow(c, "google");
  });

  // GET /callback/github - Handle GitHub OAuth callback
  server.get("/callback/github", async (c) => {
    return handleOAuthCallback(c, "github");
  });

  // GET /callback/google - Handle Google OAuth callback
  server.get("/callback/google", async (c) => {
    return handleOAuthCallback(c, "google");
  });

  // POST /signout - Clear session
  server.post("/signout", (c) => {
    // Clear session cookie
    setCookie(c, SESSION_COOKIE_NAME, "", {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: SESSION_SECURE,
      maxAge: 0,
    });

    return c.json({ ok: true });
  });

  // POST /reset-password - Reset password with verified token
  server.post(
    "/reset-password",
    validator("json", (value) => {
      return schemaResetPasswordRequest.parse(value);
    }),
    async (c) => {
      const { password } = c.req.valid("json");
      const db = await c.env.database();

      // Get verified token from cookie
      const verifiedToken = getCookie(c, "password_reset_verified");
      if (!verifiedToken) {
        return c.json({ error: "Session expired" }, 401);
      }

      // Decode the verified token
      const decoded = await decode({
        secret: c.env.AUTH_SECRET,
        salt: "password-reset-verified",
        token: verifiedToken,
      });

      if (!decoded?.email) {
        return c.json({ error: "Invalid session" }, 401);
      }

      // Get user
      const user = await db.selectUserByEmail(decoded.email as string);
      if (!user) {
        return c.json({ error: "User not found" }, 404);
      }

      // Hash and update password
      const hashedPassword = await hashPassword(password);
      await db.updateUserByID({ id: user.id, password: hashedPassword });

      // Clear cookies
      setCookie(c, "password_reset_verified", "", {
        path: "/",
        maxAge: 0,
        secure: SESSION_SECURE,
      });
      setCookie(c, "email_verification_token", "", {
        path: "/",
        maxAge: 0,
        secure: SESSION_SECURE,
      });

      return c.json({ ok: true });
    }
  );

  // POST /request-email-change - Request email change
  server.post(
    "/request-email-change",
    withAuth,
    validator("json", (value) => {
      return schemaRequestEmailChangeRequest.parse(value);
    }),
    async (c) => {
      const { currentPassword, newEmail } = c.req.valid("json");
      const userId = c.get("user_id");
      const db = await c.env.database();

      // Get current user
      const user = await db.selectUserByID(userId);
      if (!user) {
        return c.json({ error: "User not found" }, 404);
      }

      // Check if user has a password
      if (!user.password) {
        return c.json(
          { error: "Password authentication is not enabled for this account" },
          400
        );
      }

      // Verify current password
      const passwordValid = await compare(currentPassword, user.password);
      if (!passwordValid) {
        return c.json({ error: "Current password is incorrect" }, 401);
      }

      // Check if new email is the same as current
      if (newEmail.toLowerCase() === user.email?.toLowerCase()) {
        return c.json(
          { error: "New email must be different from current email" },
          400
        );
      }

      // Check if email is already in use
      const existingUser = await db.selectUserByEmail(newEmail);
      if (existingUser) {
        return c.json({ error: "This email is already registered" }, 400);
      }

      // If sendEmail not configured, update immediately
      if (!c.env.sendEmail) {
        await db.updateUserByID({ id: userId, email: newEmail });
        return c.json({ ok: true });
      }

      // Generate verification code
      const code = Math.floor(100000000 + Math.random() * 900000000).toString();

      // Insert verification code
      await db.insertEmailVerification({
        email: newEmail,
        code,
        expiresAt: new Date(Date.now() + 1000 * 60 * 15),
      });

      // Generate token
      const token = await encode({
        secret: c.env.AUTH_SECRET,
        salt: "email-verification",
        token: {
          id: crypto.randomUUID(),
          email: newEmail,
        },
      });

      // Set cookie
      setCookie(c, "email_verification_token", token, {
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
        secure: SESSION_SECURE,
        maxAge: 1000 * 60 * 15,
      });

      // Send verification email
      try {
        await c.env.sendEmail({
          type: "verification",
          email: newEmail,
          name: user.display_name || "User",
          code,
        });
      } catch (err) {
        console.error("Failed to send email verification:", err);
      }

      return c.json({ ok: true });
    }
  );

  // POST /verify-email-change - Verify email change with code
  server.post(
    "/verify-email-change",
    withAuth,
    validator("json", (value) => {
      return schemaVerifyEmailChangeRequest.parse(value);
    }),
    async (c) => {
      const { code } = c.req.valid("json");
      const userId = c.get("user_id");
      const db = await c.env.database();

      // Get token from cookie
      const token = getCookie(c, "email_verification_token");
      if (!token) {
        return c.json({ error: "Session expired" }, 401);
      }

      // Decode the email verification token
      const decoded = await decode({
        secret: c.env.AUTH_SECRET,
        salt: "email-verification",
        token,
      });

      if (!decoded?.email) {
        return c.json({ error: "Invalid token" }, 401);
      }

      // Verify the code
      const emailVerification = await db.selectAndDeleteEmailVerificationByCode(
        {
          email: decoded.email as string,
          code,
        }
      );

      if (!emailVerification) {
        return c.json({ error: "Invalid or expired code" }, 401);
      }

      // Get current user
      const user = await db.selectUserByID(userId);
      if (!user) {
        return c.json({ error: "User not found" }, 404);
      }

      // Update user email and reset email_verified
      await db.updateUserByID({
        id: userId,
        email: decoded.email as string,
        email_verified: null,
      });

      // Clear the verification cookie
      setCookie(c, "email_verification_token", "", {
        path: "/",
        maxAge: 0,
        secure: SESSION_SECURE,
      });

      return c.json({ ok: true });
    }
  );

  // POST /signup - Create new user with email/password
  server.post(
    "/signup",
    validator("json", (value) => {
      return schemaSignupRequest.parse(value);
    }),
    async (c) => {
      const { email, password, redirect: redirectTarget } = c.req.valid("json");
      const db = await c.env.database();

      if (!(await isPublicSignupAllowed(c, db))) {
        return c.json({ error: "Signups are disabled" }, 403);
      }

      // Check if user exists
      const existingUser = await db.selectUserByEmail(email);
      if (existingUser) {
        return c.json({ error: "User with this email already exists" }, 400);
      }

      // Hash password and create user
      const hashedPassword = await hashPassword(password);

      // If emails are not configured, verify immediately
      const emailVerified = c.env.sendEmail ? null : new Date();

      const user = await provisionUser({
        db,
        autoJoinOrganizations: c.env.autoJoinOrganizations,
        user: {
          display_name: null,
          email,
          password: hashedPassword,
          email_verified: emailVerified,
        },
      });

      // Sync user to telemetry system (async, don't block)
      if (c.env.sendTelemetryEvent) {
        c.env
          .sendTelemetryEvent({
            type: "user.registered",
            userId: user.id,
            email: user.email,
            name: user.display_name,
          })
          .then(() => {
            // If this user was previously invited, merge the records
            if (user.email && c.env.sendTelemetryEvent) {
              return c.env.sendTelemetryEvent({
                type: "user.merged",
                primaryUserId: user.id,
                secondaryUserId: user.email,
              });
            }
          })
          .catch(() => {
            // Ignore errors to avoid breaking user creation
          });
      }

      // If emails are configured, send verification email
      if (c.env.sendEmail) {
        // Generate email verification token
        const code = Math.floor(
          100000000 + Math.random() * 900000000
        ).toString();
        await db.insertEmailVerification({
          email,
          code,
          expiresAt: new Date(Date.now() + 1000 * 60 * 15),
        });

        const token = await encode({
          secret: c.env.AUTH_SECRET,
          salt: "email-verification",
          token: {
            id: crypto.randomUUID(),
            email,
          },
        });

        // Set verification cookie
        setCookie(c, "email_verification_token", token, {
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          secure: SESSION_SECURE,
          maxAge: 1000 * 60 * 15,
        });

        // Send verification email
        try {
          const user = await db.selectUserByEmail(email);
          if (user) {
            await c.env.sendEmail({
              type: "verification",
              email,
              name: user.display_name,
              code,
            });
          }
        } catch (err) {
          console.error("Failed to send verification email:", err);
        }

        const redirectUrl = redirectTarget
          ? `/email-verification?redirect=${encodeURIComponent(redirectTarget)}`
          : "/email-verification";

        return c.json({ ok: true, redirect_url: redirectUrl });
      } else {
        // No email verification needed - create session and redirect to chat
        const sessionToken = await encode({
          secret: c.env.AUTH_SECRET,
          token: {
            sub: user.id,
            id: user.id,
            email: user.email,
            name: user.display_name,
          },
          salt: SESSION_COOKIE_NAME,
        });

        setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          secure: SESSION_SECURE,
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });

        setCookie(c, "last_login_provider", "credentials", {
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          secure: SESSION_SECURE,
          maxAge: 60 * 60 * 24 * 180, // 180 days
        });

        return c.json({ ok: true, redirect_url: "/chat" });
      }
    }
  );

  // POST /resend-email-verification - Resend email verification code
  server.post("/resend-email-verification", async (c) => {
    const token = getCookie(c, "email_verification_token");
    if (!token) {
      return c.json({ error: "No verification session found" }, 400);
    }

    // Decode token to get email
    const decoded = await decode({
      secret: c.env.AUTH_SECRET,
      salt: "email-verification",
      token,
    });

    if (!decoded?.email) {
      return c.json({ error: "Invalid verification token" }, 400);
    }

    const email = decoded.email as string;
    const db = await c.env.database();

    // Generate new code
    const code = Math.floor(100000000 + Math.random() * 900000000).toString();
    await db.insertEmailVerification({
      email,
      code,
      expiresAt: new Date(Date.now() + 1000 * 60 * 15),
    });

    // Generate new token
    const newToken = await encode({
      secret: c.env.AUTH_SECRET,
      salt: "email-verification",
      token: {
        id: crypto.randomUUID(),
        email,
      },
    });

    // Update cookie
    setCookie(c, "email_verification_token", newToken, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: SESSION_SECURE,
      maxAge: 1000 * 60 * 15,
    });

    // Send new verification email
    if (c.env.sendEmail) {
      try {
        const user = await db.selectUserByEmail(email);
        if (user) {
          await c.env.sendEmail({
            type: "verification",
            email,
            name: user.display_name,
            code,
          });
        }
      } catch (err) {
        console.error("Failed to resend verification email:", err);
      }
    }

    return c.json({ ok: true });
  });

  // POST /request-password-reset - Request password reset
  server.post(
    "/request-password-reset",
    validator("json", (value) => {
      return schemaRequestPasswordResetRequest.parse(value);
    }),
    async (c) => {
      const { email } = c.req.valid("json");
      const db = await c.env.database();

      // Check if sendEmail is configured
      if (!c.env.sendEmail) {
        return c.json(
          { error: "Password reset requires email to be configured" },
          400
        );
      }

      // Check if user exists
      const user = await db.selectUserByEmail(email);

      // Always return success to prevent email enumeration
      // But only send email if user exists
      if (user) {
        // Generate reset code
        const code = Math.floor(
          100000000 + Math.random() * 900000000
        ).toString();
        await db.insertEmailVerification({
          email,
          code,
          expiresAt: new Date(Date.now() + 1000 * 60 * 15),
        });

        const token = await encode({
          secret: c.env.AUTH_SECRET,
          salt: "email-verification",
          token: {
            id: crypto.randomUUID(),
            email,
          },
        });

        // Set cookie
        setCookie(c, "email_verification_token", token, {
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          secure: SESSION_SECURE,
          maxAge: 60 * 15,
        });

        // Send reset email
        try {
          await c.env.sendEmail({
            type: "password-reset",
            email,
            name: user.display_name,
            code,
          });
        } catch (err) {
          console.error("Failed to send password reset email:", err);
        }
      }

      return c.json({
        ok: true,
        redirect_url: "/reset-password/verify",
      });
    }
  );

  // POST /resend-password-reset - Resend password reset code
  server.post("/resend-password-reset", async (c) => {
    const token = getCookie(c, "email_verification_token");
    if (!token) {
      return c.json({ error: "No reset session found" }, 400);
    }

    // Decode token to get email
    const decoded = await decode({
      secret: c.env.AUTH_SECRET,
      salt: "email-verification",
      token,
    });

    if (!decoded?.email) {
      return c.json({ error: "Invalid reset token" }, 400);
    }

    const email = decoded.email as string;
    const db = await c.env.database();

    // Verify user exists
    const user = await db.selectUserByEmail(email);
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    // Generate new code
    const code = Math.floor(100000000 + Math.random() * 900000000).toString();
    await db.insertEmailVerification({
      email,
      code,
      expiresAt: new Date(Date.now() + 1000 * 60 * 15),
    });

    // Generate new token
    const newToken = await encode({
      secret: c.env.AUTH_SECRET,
      salt: "email-verification",
      token: {
        id: crypto.randomUUID(),
        email,
      },
    });

    // Update cookie
    setCookie(c, "email_verification_token", newToken, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: SESSION_SECURE,
      maxAge: 60 * 15,
    });

    // Send new reset email
    if (c.env.sendEmail) {
      try {
        await c.env.sendEmail({
          type: "password-reset",
          email,
          name: user.display_name,
          code,
        });
      } catch (err) {
        console.error("Failed to resend password reset email:", err);
      }
    }

    return c.json({ ok: true });
  });
}
