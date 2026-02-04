import { hash } from "bcrypt-ts";
import Client from "@blink.so/api";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { http, HttpResponse } from "msw";
import { setupServer, SetupServerApi } from "msw/node";
import { serve } from "../../test";

// Mock OAuth provider responses
const mockGitHubProfile = {
  id: 123456,
  email: "github@example.com",
  name: "GitHub User",
  login: "githubuser",
  avatar_url: "https://github.com/avatar.jpg",
};

const mockGoogleProfile = {
  id: "google-id-123",
  email: "google@example.com",
  name: "Google User",
  picture: "https://google.com/avatar.jpg",
};

const mockOAuthTokenResponse = {
  access_token: "mock-access-token",
  token_type: "Bearer",
  expires_in: 3600,
  refresh_token: "mock-refresh-token",
  scope: "user:email",
};

test("GET /csrf returns CSRF token", async () => {
  const { url } = await serve();
  const res = await fetch(`${url}/api/auth/csrf`);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.csrfToken).toBeString();
  expect(data.csrfToken.length).toBeGreaterThan(0);
});

test("GET /providers returns available providers", async () => {
  const { url } = await serve();
  const res = await fetch(`${url}/api/auth/providers`);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.credentials).toEqual({
    id: "credentials",
    name: "Credentials",
    type: "credentials",
  });
  expect(data.github).toEqual({
    id: "github",
    name: "GitHub",
    type: "oauth",
  });
  expect(data.google).toEqual({
    id: "google",
    name: "Google",
    type: "oauth",
  });
});

test("GET /providers hides oauth providers when disabled", async () => {
  const { url } = await serve({
    bindings: {
      enableOauth: false,
    },
  });
  const res = await fetch(`${url}/api/auth/providers`);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.credentials).toEqual({
    id: "credentials",
    name: "Credentials",
    type: "credentials",
  });
  expect(data.github).toBeUndefined();
  expect(data.google).toBeUndefined();
});

test("GET /session returns empty when no session", async () => {
  const { url } = await serve();
  const res = await fetch(`${url}/api/auth/session`);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data).toEqual({});
});

test("GET /session returns user data with valid session", async () => {
  const { helpers, bindings, url } = await serve();
  const { user } = await helpers.createUser({
    email: "test@example.com",
    display_name: "Test User",
  });

  // Create session token
  const { encode } = await import("next-auth/jwt");
  const token = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "blink_session_token",
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.display_name,
      avatar_url: null,
      organization_id: user.organization_id,
    },
  });

  const res = await fetch(`${url}/api/auth/session`, {
    headers: {
      Cookie: `blink_session_token=${token}`,
    },
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.user).toBeDefined();
  expect(data.user.id).toBe(user.id);
  expect(data.user.email).toBe(user.email);
  expect(data.user.name).toBe(user.display_name);
  expect(data.expires).toBeString();
});

test("POST /signin/credentials with valid credentials", async () => {
  const { helpers, url, bindings } = await serve();
  const password = "password123";
  const hashedPassword = await hash(password, 10);

  const db = await bindings.database();
  const { user } = await helpers.createUser({
    email: "login@example.com",
    display_name: "Login User",
  });

  // Set password and verify email
  await db.updateUserByID({
    id: user.id,
    password: hashedPassword,
    email_verified: new Date(),
  });

  const res = await fetch(`${url}/api/auth/signin/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "login@example.com",
      password,
    }),
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.ok).toBe(true);
  expect(data.url).toBe("/chat");

  // Check cookies - note: Response.headers.getSetCookie() returns all Set-Cookie headers
  const cookies = res.headers.getSetCookie?.() || [
    res.headers.get("Set-Cookie") || "",
  ];
  const cookieString = cookies.join("; ");
  expect(cookieString).toContain("blink_session_token=");
  expect(cookieString).toContain("last_login_provider=credentials");
});

test("POST /signin/credentials with invalid password", async () => {
  const { helpers, url, bindings } = await serve();
  const hashedPassword = await hash("correctpassword", 10);

  const db = await bindings.database();
  const { user } = await helpers.createUser({
    email: "wrong@example.com",
  });

  await db.updateUserByID({
    id: user.id,
    password: hashedPassword,
    email_verified: new Date(),
  });

  const res = await fetch(`${url}/api/auth/signin/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "wrong@example.com",
      password: "wrongpassword",
    }),
  });

  expect(res.status).toBe(401);
  const data = await res.json();
  expect(data.error).toBe("Invalid credentials");
});

test("POST /signin/credentials with unverified email", async () => {
  const { helpers, url, bindings } = await serve();
  const password = "password123";
  const hashedPassword = await hash(password, 10);

  const db = await bindings.database();
  const { user } = await helpers.createUser({
    email: "unverified@example.com",
  });

  await db.updateUserByID({
    id: user.id,
    password: hashedPassword,
    email_verified: null, // Not verified
  });

  const res = await fetch(`${url}/api/auth/signin/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "unverified@example.com",
      password,
    }),
  });

  expect(res.status).toBe(401);
  const data = await res.json();
  expect(data.error).toBe("Email not verified");
});

test("POST /signin/credentials with non-existent user", async () => {
  const { url } = await serve();
  const res = await fetch(`${url}/api/auth/signin/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "nonexistent@example.com",
      password: "password123",
    }),
  });

  expect(res.status).toBe(401);
  const data = await res.json();
  expect(data.error).toBe("Invalid credentials");
});

test("POST /signin/credentials with missing fields", async () => {
  const { url } = await serve();
  const res = await fetch(`${url}/api/auth/signin/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "test@example.com",
      // Missing password
    }),
  });

  expect(res.status).toBe(400);
});

test("POST /signout clears session cookie", async () => {
  const { url } = await serve();
  const res = await fetch(`${url}/api/auth/signout`, {
    method: "POST",
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.ok).toBe(true);

  const cookies = res.headers.get("Set-Cookie");
  expect(cookies).toContain("blink_session_token=");
  expect(cookies).toContain("Max-Age=0");
});

test("GET /signin/github redirects to GitHub OAuth", async () => {
  const { url, bindings } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-github-client-id",
      GITHUB_CLIENT_SECRET: "test-github-client-secret",
    },
  });

  const res = await fetch(`${url}/api/auth/signin/github`, {
    redirect: "manual",
  });

  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toStartWith("https://github.com/login/oauth/authorize");
  expect(location).toContain("client_id=test-github-client-id");
  expect(location).toContain("scope=user%3Aemail");
  expect(location).toContain("state=");
  expect(location).toContain("response_type=code");
});

test("GET /signin/github redirects to login when oauth disabled", async () => {
  const { url } = await serve({
    bindings: {
      enableOauth: false,
    },
  });

  const res = await fetch(`${url}/api/auth/signin/github`, {
    redirect: "manual",
  });

  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toContain("/login?error=oauth_disabled");
});

test("GET /signin/google redirects to Google OAuth", async () => {
  const { url } = await serve({
    bindings: {
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    },
  });

  const res = await fetch(`${url}/api/auth/signin/google`, {
    redirect: "manual",
  });

  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toStartWith("https://accounts.google.com/o/oauth2/v2/auth");
  expect(location).toContain("client_id=test-google-client-id");
  expect(location).toContain("scope=openid+email+profile");
  expect(location).toContain("access_type=offline");
  expect(location).toContain("prompt=consent");
});

test("GET /callback/github redirects to login when oauth disabled", async () => {
  const { url } = await serve({
    bindings: {
      enableOauth: false,
    },
  });

  const res = await fetch(
    `${url}/api/auth/callback/github?code=test-code&state=disabled-state`,
    {
      redirect: "manual",
    }
  );

  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toContain("/login?error=oauth_disabled");
});

test("GET /signin/unknown-provider returns 404", async () => {
  const { url } = await serve();
  const res = await fetch(`${url}/api/auth/signin/unknown`);
  expect(res.status).toBe(404);
  // 404 response from Hono - route doesn't exist
});

test("GET /callback/github with missing code returns error", async () => {
  const { url, bindings } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
    },
  });

  // Generate valid state
  const { encode } = await import("next-auth/jwt");
  const state = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "github",
      nonce: "test-nonce",
      callbackUrl: `${url}/api/auth/callback/github`,
    },
  });

  const res = await fetch(`${url}/api/auth/callback/github?state=${state}`, {
    redirect: "manual",
  });

  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toContain("/login?error=missing_params");
});

test("GET /callback/github with invalid state returns error", async () => {
  const { url } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
    },
  });

  const res = await fetch(
    `${url}/api/auth/callback/github?code=test-code&state=invalid-state`,
    {
      redirect: "manual",
    }
  );

  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toContain("/login?error=invalid_state");
});

// OAuth Integration Tests with MSW
let mswServer: SetupServerApi;

beforeEach(() => {
  mswServer = setupServer();
  mswServer.listen({
    onUnhandledRequest: "bypass",
  });
});

afterEach(() => {
  if (mswServer) {
    mswServer.close();
  }
});

test("GET /callback/github creates new user on successful OAuth", async () => {
  const { url, bindings } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
    },
  });

  // Mock GitHub OAuth token exchange
  mswServer.use(
    http.post("https://github.com/login/oauth/access_token", () => {
      return HttpResponse.json(mockOAuthTokenResponse);
    }),
    http.get("https://api.github.com/user", () => {
      return HttpResponse.json(mockGitHubProfile);
    })
  );

  const { encode } = await import("next-auth/jwt");
  const state = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "github",
      nonce: "test-nonce",
      callbackUrl: `${url}/api/auth/callback/github`,
    },
  });

  const res = await fetch(
    `${url}/api/auth/callback/github?code=test-code&state=${state}`,
    {
      redirect: "manual",
    }
  );

  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toBe("/chat");

  // Verify cookies were set
  const cookies = res.headers.getSetCookie?.() || [
    res.headers.get("Set-Cookie") || "",
  ];
  const cookieString = cookies.join("; ");
  expect(cookieString).toContain("blink_session_token=");
  expect(cookieString).toContain("last_login_provider=github");

  // Verify user was created in database
  const db = await bindings.database();
  const user = await db.selectUserByEmail(mockGitHubProfile.email);
  expect(user).toBeDefined();
  expect(user!.email).toBe(mockGitHubProfile.email);
  expect(user!.display_name).toBe(mockGitHubProfile.name);

  // Verify OAuth account was linked
  const accountResult = await db.selectUserAccountByProviderAccountID(
    "github",
    mockGitHubProfile.id.toString()
  );
  expect(accountResult).toBeDefined();
  expect(accountResult!.user_account.user_id).toBe(user!.id);
  expect(accountResult!.user_account.provider).toBe("github");
  expect(accountResult!.user_account.access_token).toBe(
    mockOAuthTokenResponse.access_token
  );
});

test("GET /callback/google creates new user on successful OAuth", async () => {
  const { url, bindings } = await serve({
    bindings: {
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    },
  });

  // Mock Google OAuth token exchange
  mswServer.use(
    http.post("https://oauth2.googleapis.com/token", () => {
      return HttpResponse.json(mockOAuthTokenResponse);
    }),
    http.get("https://www.googleapis.com/oauth2/v2/userinfo", () => {
      return HttpResponse.json(mockGoogleProfile);
    })
  );

  const { encode } = await import("next-auth/jwt");
  const state = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "google",
      nonce: "test-nonce",
      callbackUrl: `${url}/api/auth/callback/google`,
    },
  });

  const res = await fetch(
    `${url}/api/auth/callback/google?code=test-code&state=${state}`,
    {
      redirect: "manual",
    }
  );

  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/chat");

  const db = await bindings.database();
  const user = await db.selectUserByEmail(mockGoogleProfile.email);
  expect(user).toBeDefined();
  expect(user!.email).toBe(mockGoogleProfile.email);
  expect(user!.display_name).toBe(mockGoogleProfile.name);

  const accountResult = await db.selectUserAccountByProviderAccountID(
    "google",
    mockGoogleProfile.id
  );
  expect(accountResult).toBeDefined();
  expect(accountResult!.user_account.provider).toBe("google");
});

test("GET /callback/github returns existing OAuth user on repeat login", async () => {
  const { url, bindings } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
    },
  });

  mswServer.use(
    http.post("https://github.com/login/oauth/access_token", () => {
      return HttpResponse.json(mockOAuthTokenResponse);
    }),
    http.get("https://api.github.com/user", () => {
      return HttpResponse.json(mockGitHubProfile);
    })
  );

  const { encode } = await import("next-auth/jwt");
  const state = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "github",
      nonce: "test-nonce",
      callbackUrl: `${url}/api/auth/callback/github`,
    },
  });

  // First login - creates user
  await fetch(`${url}/api/auth/callback/github?code=test-code&state=${state}`, {
    redirect: "manual",
  });

  const db = await bindings.database();
  const firstUser = await db.selectUserByEmail(mockGitHubProfile.email);
  expect(firstUser).toBeDefined();

  // Generate new state for second login
  const state2 = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "github",
      nonce: "test-nonce-2",
      callbackUrl: `${url}/api/auth/callback/github`,
    },
  });

  // Second login - should return same user
  const res2 = await fetch(
    `${url}/api/auth/callback/github?code=test-code-2&state=${state2}`,
    {
      redirect: "manual",
    }
  );

  expect(res2.status).toBe(302);
  expect(res2.headers.get("Location")).toBe("/chat");

  // Verify same user is returned
  const secondUser = await db.selectUserByEmail(mockGitHubProfile.email);
  expect(secondUser).toBeDefined();
  expect(secondUser!.id).toBe(firstUser!.id);
});

test("GET /callback/github with no access token returns error", async () => {
  const { url, bindings } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
    },
  });

  // Mock GitHub returning error instead of access token
  mswServer.use(
    http.post("https://github.com/login/oauth/access_token", () => {
      return HttpResponse.json({ error: "access_denied" });
    })
  );

  const { encode } = await import("next-auth/jwt");
  const state = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "github",
      nonce: "test-nonce",
      callbackUrl: `${url}/api/auth/callback/github`,
    },
  });

  const res = await fetch(
    `${url}/api/auth/callback/github?code=test-code&state=${state}`,
    {
      redirect: "manual",
    }
  );

  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toContain("/login?error=no_access_token");
});

test("OAuth callback with wrong provider in state returns error", async () => {
  const { url, bindings } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
    },
  });

  // Generate state for google but request github callback
  const { encode } = await import("next-auth/jwt");
  const state = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "google", // Wrong provider
      nonce: "test-nonce",
      callbackUrl: `${url}/api/auth/callback/google`,
    },
  });

  const res = await fetch(
    `${url}/api/auth/callback/github?code=test-code&state=${state}`,
    {
      redirect: "manual",
    }
  );

  expect(res.status).toBe(302);
  const location = res.headers.get("Location");
  expect(location).toContain("/login?error=invalid_state");
});

test("POST /verify-email with valid code verifies email and creates session", async () => {
  const { url, helpers, bindings } = await serve();
  const hashedPassword = await hash("password123", 10);

  const db = await bindings.database();
  const { user } = await helpers.createUser({
    email: "verify@example.com",
    email_verified: null,
  });

  // Update user with password
  await db.updateUserByID({
    id: user.id,
    password: hashedPassword,
  });

  // Create an email verification code
  const code = "12345678";
  await db.insertEmailVerification({
    email: user.email!,
    code,
    expiresAt: new Date(Date.now() + 1000 * 60 * 15),
  });

  // Generate verification token and set it as a cookie
  const { encode } = await import("next-auth/jwt");
  const token = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "email-verification",
    token: {
      id: crypto.randomUUID(),
      email: user.email,
    },
  });

  const res = await fetch(`${url}/api/auth/verify-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `email_verification_token=${token}`,
    },
    body: JSON.stringify({ code }),
  });

  expect(res.status).toBe(200);
  const data = (await res.json()) as { ok: boolean };
  expect(data.ok).toBe(true);

  // Verify session cookie was set
  const cookies = res.headers.get("Set-Cookie");
  expect(cookies).toContain("blink_session_token");

  // Verify user's email_verified was updated
  const updatedUser = await db.selectUserByID(user.id);
  expect(updatedUser?.email_verified).not.toBeNull();

  // Verify the code was deleted by the API (trying to use it again should fail)
  const secondAttempt = await fetch(`${url}/api/auth/verify-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `email_verification_token=${token}`,
    },
    body: JSON.stringify({ code }),
  });
  expect(secondAttempt.status).toBe(401);
});

test("POST /verify-email with invalid code returns error", async () => {
  const { url, helpers, bindings } = await serve();

  const { user } = await helpers.createUser({
    email: "invalid@example.com",
    email_verified: null,
  });

  // Generate verification token and set it as a cookie
  const { encode } = await import("next-auth/jwt");
  const token = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "email-verification",
    token: {
      id: crypto.randomUUID(),
      email: user.email,
    },
  });

  const res = await fetch(`${url}/api/auth/verify-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `email_verification_token=${token}`,
    },
    body: JSON.stringify({ code: "wrong-code" }),
  });

  expect(res.status).toBe(401);
  const data = (await res.json()) as { error: string };
  expect(data.error).toBe("Invalid code");
});

test("POST /signup creates user and returns redirect URL", async () => {
  const { url, bindings } = await serve();
  const email = "newuser@example.com";
  const password = "securepassword123";

  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.ok).toBe(true);
  expect(data.redirect_url).toBe("/email-verification");

  // Verify user was created
  const db = await bindings.database();
  const user = await db.selectUserByEmail(email);
  expect(user).toBeDefined();
  expect(user?.email).toBe(email);
  expect(user?.password).toBeDefined();
  expect(user?.email_verified).toBeNull();

  // Verify verification cookie was set
  const cookies = res.headers.get("set-cookie");
  expect(cookies).toContain("email_verification_token");
  expect(cookies).toContain("HttpOnly");
  expect(cookies).toContain("SameSite=Lax");
});

test("POST /signup with redirect returns custom redirect URL", async () => {
  const { url } = await serve();
  const email = "redirect@example.com";
  const password = "securepassword123";
  const redirect = "/custom-path";

  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, redirect }),
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.redirect_url).toBe(
    `/email-verification?redirect=${encodeURIComponent(redirect)}`
  );
});

test("POST /signup rejects duplicate email", async () => {
  const { url, helpers } = await serve({
    bindings: {
      enableSignups: true,
    },
  });
  const email = "existing@example.com";

  await helpers.createUser({ email });

  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password: "password123" }),
  });

  expect(res.status).toBe(400);
  const data = await res.json();
  expect(data.error).toContain("already exists");
});

test("POST /signup validates email format", async () => {
  const { url } = await serve();

  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: "invalid-email", password: "password123" }),
  });

  expect(res.status).toBe(400);
});

test("POST /signup validates password length", async () => {
  const { url } = await serve();

  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: "test@example.com", password: "short" }),
  });

  expect(res.status).toBe(400);
});

test("POST /signup without email verification creates session and redirects to chat", async () => {
  const { url, bindings } = await serve({
    bindings: {
      sendEmail: undefined, // Disable email verification
    },
  });
  const email = "noeverify@example.com";
  const password = "securepassword123";

  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.ok).toBe(true);
  expect(data.redirect_url).toBe("/chat");

  // Verify user was created
  const db = await bindings.database();
  const user = await db.selectUserByEmail(email);
  expect(user).toBeDefined();
  expect(user?.email).toBe(email);

  // Verify session cookie was set (auto-login)
  const cookies = res.headers.getSetCookie?.() || [
    res.headers.get("Set-Cookie") || "",
  ];
  const cookieString = cookies.join("; ");
  expect(cookieString).toContain("blink_session_token=");
  expect(cookieString).toContain("last_login_provider=credentials");
});

test("POST /signup rejects when signups are disabled and not first user", async () => {
  const { url, helpers } = await serve({
    bindings: {
      enableSignups: false,
    },
  });

  await helpers.createUser({ email: "existing@example.com" });

  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "blocked@example.com",
      password: "password123",
    }),
  });

  expect(res.status).toBe(403);
  const data = await res.json();
  expect(data.error).toBe("Signups are disabled");
});

test("POST /resend-email-verification regenerates token", async () => {
  const { url, helpers, bindings } = await serve();
  const { user } = await helpers.createUser({
    email: "verify@example.com",
    email_verified: null,
  });

  const db = await bindings.database();

  // Create initial verification code
  const initialCode = "11111111";
  await db.insertEmailVerification({
    email: user.email!,
    code: initialCode,
    expiresAt: new Date(Date.now() + 1000 * 60 * 15),
  });

  // Generate initial verification token
  const { encode } = await import("next-auth/jwt");
  const initialToken = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "email-verification",
    token: {
      id: crypto.randomUUID(),
      email: user.email,
    },
  });

  const res = await fetch(`${url}/api/auth/resend-email-verification`, {
    method: "POST",
    headers: {
      Cookie: `email_verification_token=${initialToken}`,
    },
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.ok).toBe(true);

  // Verify new token was set in cookie
  const cookies = res.headers.get("set-cookie");
  expect(cookies).toContain("email_verification_token");
  expect(cookies).toContain("HttpOnly");
});

test("POST /resend-email-verification fails without cookie", async () => {
  const { url } = await serve();

  const res = await fetch(`${url}/api/auth/resend-email-verification`, {
    method: "POST",
  });

  expect(res.status).toBe(400);
  const data = await res.json();
  expect(data.error).toContain("No verification session");
});

test("POST /request-password-reset creates reset token for existing user", async () => {
  const { url, helpers, bindings } = await serve();
  const { user } = await helpers.createUser({
    email: "reset@example.com",
    password: await hash("oldpassword", 12),
  });

  const res = await fetch(`${url}/api/auth/request-password-reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: user.email }),
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.ok).toBe(true);
  expect(data.redirect_url).toBe("/reset-password/verify");

  // Verify cookie was set
  const cookies = res.headers.get("set-cookie");
  expect(cookies).toContain("email_verification_token");
  expect(cookies).toContain("HttpOnly");
});

test("POST /request-password-reset always returns success (no email enumeration)", async () => {
  const { url } = await serve();
  const nonExistentEmail = "nonexistent@example.com";

  const res = await fetch(`${url}/api/auth/request-password-reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: nonExistentEmail }),
  });

  // Should return success even though user doesn't exist
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.ok).toBe(true);
  expect(data.redirect_url).toBe("/reset-password/verify");
});

test("POST /request-password-reset validates email format", async () => {
  const { url } = await serve();

  const res = await fetch(`${url}/api/auth/request-password-reset`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: "not-an-email" }),
  });

  expect(res.status).toBe(400);
});

test("POST /resend-password-reset regenerates reset token", async () => {
  const { url, helpers, bindings } = await serve();
  const { user } = await helpers.createUser({
    email: "reset2@example.com",
    password: await hash("password", 12),
  });

  const db = await bindings.database();

  // Create initial reset code
  const initialCode = "99999999";
  await db.insertEmailVerification({
    email: user.email!,
    code: initialCode,
    expiresAt: new Date(Date.now() + 1000 * 60 * 15),
  });

  // Generate initial reset token
  const { encode } = await import("next-auth/jwt");
  const initialToken = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "email-verification",
    token: {
      id: crypto.randomUUID(),
      email: user.email,
    },
  });

  const res = await fetch(`${url}/api/auth/resend-password-reset`, {
    method: "POST",
    headers: {
      Cookie: `email_verification_token=${initialToken}`,
    },
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.ok).toBe(true);

  // Verify new token was set
  const cookies = res.headers.get("set-cookie");
  expect(cookies).toContain("email_verification_token");
  expect(cookies).toContain("HttpOnly");
});

test("POST /resend-password-reset fails without cookie", async () => {
  const { url } = await serve();

  const res = await fetch(`${url}/api/auth/resend-password-reset`, {
    method: "POST",
  });

  expect(res.status).toBe(400);
  const data = await res.json();
  expect(data.error).toContain("No reset session");
});

test("POST /resend-password-reset fails for non-existent user", async () => {
  const { url, bindings } = await serve();

  // Generate token for non-existent user
  const { encode } = await import("next-auth/jwt");
  const token = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "email-verification",
    token: {
      id: crypto.randomUUID(),
      email: "nonexistent@example.com",
    },
  });

  const res = await fetch(`${url}/api/auth/resend-password-reset`, {
    method: "POST",
    headers: {
      Cookie: `email_verification_token=${token}`,
    },
  });

  expect(res.status).toBe(404);
  const data = await res.json();
  expect(data.error).toContain("User not found");
});

// Site admin role tests

test("POST /signup first user with autoJoinOrganizations gets site_role admin", async () => {
  const { url, bindings } = await serve({
    bindings: {
      sendEmail: undefined, // Disable email verification for immediate login
      autoJoinOrganizations: true,
    },
  });

  const email = "firstuser@example.com";
  const password = "securepassword123";

  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  expect(res.status).toBe(200);

  // Verify user was created with admin role
  const db = await bindings.database();
  const user = await db.selectUserByEmail(email);
  expect(user).toBeDefined();
  expect(user?.site_role).toBe("admin");
});

test("POST /signup second user with autoJoinOrganizations gets site_role member", async () => {
  const { url, bindings, helpers } = await serve({
    bindings: {
      sendEmail: undefined,
      autoJoinOrganizations: true,
      enableSignups: true,
    },
  });

  // Create first user (will be admin and create default org)
  const { user: firstUser } = await helpers.createUser({
    email: "admin@example.com",
    site_role: "admin",
  });

  // Create default team organization so second user is not "first"
  const db = await bindings.database();
  await db.insertOrganizationWithMembership({
    name: "default",
    kind: "organization",
    created_by: firstUser.id,
  });

  // Sign up second user
  const email = "seconduser@example.com";
  const password = "securepassword123";

  const res = await fetch(`${url}/api/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  expect(res.status).toBe(200);

  // Verify second user has member role
  const secondUser = await db.selectUserByEmail(email);
  expect(secondUser).toBeDefined();
  expect(secondUser?.site_role).toBe("member");
});

test("GET /callback/github first user with autoJoinOrganizations gets site_role admin", async () => {
  const { url, bindings } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
      autoJoinOrganizations: true,
    },
  });

  // Mock GitHub OAuth
  mswServer.use(
    http.post("https://github.com/login/oauth/access_token", () => {
      return HttpResponse.json(mockOAuthTokenResponse);
    }),
    http.get("https://api.github.com/user", () => {
      return HttpResponse.json({
        ...mockGitHubProfile,
        email: "firstoauth@example.com",
      });
    })
  );

  const { encode } = await import("next-auth/jwt");
  const state = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "github",
      nonce: "test-nonce",
      callbackUrl: `${url}/api/auth/callback/github`,
    },
  });

  const res = await fetch(
    `${url}/api/auth/callback/github?code=test-code&state=${state}`,
    {
      redirect: "manual",
    }
  );

  expect(res.status).toBe(302);

  // Verify user was created with admin role
  const db = await bindings.database();
  const user = await db.selectUserByEmail("firstoauth@example.com");
  expect(user).toBeDefined();
  expect(user?.site_role).toBe("admin");
});

test("GET /callback/github second user with autoJoinOrganizations gets site_role member", async () => {
  const { url, bindings, helpers } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
      autoJoinOrganizations: true,
      enableSignups: true,
    },
  });

  // Create first user and default org
  const { user: firstUser } = await helpers.createUser({
    email: "admin@example.com",
    site_role: "admin",
  });
  const db = await bindings.database();
  await db.insertOrganizationWithMembership({
    name: "default",
    kind: "organization",
    created_by: firstUser.id,
  });

  // Mock GitHub OAuth for second user
  mswServer.use(
    http.post("https://github.com/login/oauth/access_token", () => {
      return HttpResponse.json(mockOAuthTokenResponse);
    }),
    http.get("https://api.github.com/user", () => {
      return HttpResponse.json({
        ...mockGitHubProfile,
        id: 999999,
        email: "secondoauth@example.com",
      });
    })
  );

  const { encode } = await import("next-auth/jwt");
  const state = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "github",
      nonce: "test-nonce",
      callbackUrl: `${url}/api/auth/callback/github`,
    },
  });

  const res = await fetch(
    `${url}/api/auth/callback/github?code=test-code&state=${state}`,
    {
      redirect: "manual",
    }
  );

  expect(res.status).toBe(302);

  // Verify second user has member role
  const secondUser = await db.selectUserByEmail("secondoauth@example.com");
  expect(secondUser).toBeDefined();
  expect(secondUser?.site_role).toBe("member");
});

test("GET /callback/github blocks new user when signups are disabled", async () => {
  const { url, bindings, helpers } = await serve({
    bindings: {
      GITHUB_CLIENT_ID: "test-client-id",
      GITHUB_CLIENT_SECRET: "test-client-secret",
      autoJoinOrganizations: true,
      enableSignups: false,
    },
  });

  const { user: firstUser } = await helpers.createUser({
    email: "admin@example.com",
    site_role: "admin",
  });
  const db = await bindings.database();
  await db.insertOrganizationWithMembership({
    name: "default",
    kind: "organization",
    created_by: firstUser.id,
  });

  mswServer.use(
    http.post("https://github.com/login/oauth/access_token", () => {
      return HttpResponse.json(mockOAuthTokenResponse);
    }),
    http.get("https://api.github.com/user", () => {
      return HttpResponse.json({
        ...mockGitHubProfile,
        id: 999998,
        email: "blockedoauth@example.com",
      });
    })
  );

  const { encode } = await import("next-auth/jwt");
  const state = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "oauth-state",
    token: {
      provider: "github",
      nonce: "test-nonce",
      callbackUrl: `${url}/api/auth/callback/github`,
    },
  });

  const res = await fetch(
    `${url}/api/auth/callback/github?code=test-code&state=${state}`,
    {
      redirect: "manual",
    }
  );

  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/login?error=signups_disabled");

  const blockedUser = await db.selectUserByEmail("blockedoauth@example.com");
  expect(blockedUser).toBeUndefined();
});

// Suspended user tests

const oauthProviderConfigs = [
  {
    provider: "github" as const,
    clientIdKey: "GITHUB_CLIENT_ID",
    clientSecretKey: "GITHUB_CLIENT_SECRET",
    profile: mockGitHubProfile,
    providerAccountId: mockGitHubProfile.id.toString(),
    scope: "user:email",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
  },
  {
    provider: "google" as const,
    clientIdKey: "GOOGLE_CLIENT_ID",
    clientSecretKey: "GOOGLE_CLIENT_SECRET",
    profile: mockGoogleProfile,
    providerAccountId: mockGoogleProfile.id,
    scope: "openid email profile",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  },
];

test("POST /signin/credentials rejects suspended user", async () => {
  const { helpers, url, bindings } = await serve();
  const password = "password123";
  const hashedPassword = await hash(password, 10);

  const db = await bindings.database();
  const { user } = await helpers.createUser({
    email: "suspended@example.com",
  });

  await db.updateUserByID({
    id: user.id,
    password: hashedPassword,
    email_verified: new Date(),
    suspended: true,
  });

  const res = await fetch(`${url}/api/auth/signin/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "suspended@example.com", password }),
  });

  expect(res.status).toBe(403);
  const data = await res.json();
  expect(data.error).toBe("Your account has been suspended");
});

test.each(oauthProviderConfigs)(
  "GET /callback/$provider rejects suspended user",
  async (config) => {
    const { url, bindings, helpers } = await serve({
      bindings: {
        [config.clientIdKey]: "test-client-id",
        [config.clientSecretKey]: "test-client-secret",
      },
    });

    const db = await bindings.database();
    const { user } = await helpers.createUser({
      email: config.profile.email,
      display_name: config.profile.name,
    });

    await db.updateUserByID({ id: user.id, suspended: true });

    await db.upsertUserAccount({
      user_id: user.id,
      type: "oauth",
      provider: config.provider,
      provider_account_id: config.providerAccountId,
      access_token: "old-token",
      refresh_token: null,
      expires_at: null,
      token_type: "Bearer",
      scope: config.scope,
      id_token: null,
      session_state: "",
    });

    mswServer.use(
      http.post(config.tokenUrl, () =>
        HttpResponse.json(mockOAuthTokenResponse)
      ),
      http.get(config.userUrl, () => HttpResponse.json(config.profile))
    );

    const { encode } = await import("next-auth/jwt");
    const state = await encode({
      secret: bindings.AUTH_SECRET,
      salt: "oauth-state",
      token: {
        provider: config.provider,
        nonce: "test-nonce",
        callbackUrl: `${url}/api/auth/callback/${config.provider}`,
      },
    });

    const res = await fetch(
      `${url}/api/auth/callback/${config.provider}?code=test-code&state=${state}`,
      { redirect: "manual" }
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain(
      "/login?error=account_suspended"
    );
  }
);

test("POST /verify-email rejects suspended user", async () => {
  const { url, helpers, bindings } = await serve();

  const db = await bindings.database();
  const { user } = await helpers.createUser({
    email: "suspended-verify@example.com",
    email_verified: null,
  });

  await db.updateUserByID({ id: user.id, suspended: true });

  const code = "12345678";
  await db.insertEmailVerification({
    email: user.email!,
    code,
    expiresAt: new Date(Date.now() + 1000 * 60 * 15),
  });

  const { encode } = await import("next-auth/jwt");
  const token = await encode({
    secret: bindings.AUTH_SECRET,
    salt: "email-verification",
    token: { id: crypto.randomUUID(), email: user.email },
  });

  const res = await fetch(`${url}/api/auth/verify-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `email_verification_token=${token}`,
    },
    body: JSON.stringify({ code }),
  });

  expect(res.status).toBe(403);
  const data = (await res.json()) as { error: string };
  expect(data.error).toBe("Your account has been suspended");
});

// Change password tests

const changePasswordTestCases = [
  {
    name: "successfully changes password",
    hasPassword: true,
    currentPassword: "oldpassword123",
    newPassword: "newpassword456",
    sendCurrentPassword: "oldpassword123",
    expectedOk: true,
  },
  {
    name: "with wrong current password returns error",
    hasPassword: true,
    currentPassword: "correctpassword",
    newPassword: "newpassword456",
    sendCurrentPassword: "wrongpassword",
    expectedError: "Current password is incorrect",
  },
  {
    name: "for user without password returns error",
    hasPassword: false,
    currentPassword: null,
    newPassword: "newpassword456",
    sendCurrentPassword: "anypassword",
    expectedError: "Password authentication is not enabled for this account",
  },
  {
    name: "with short new password returns error",
    hasPassword: true,
    currentPassword: "oldpassword123",
    newPassword: "short",
    sendCurrentPassword: "oldpassword123",
    expectedError: "Too small: expected string to have >=8 characters",
  },
];

test.each(changePasswordTestCases)(
  "POST /change-password $name",
  async ({
    hasPassword,
    currentPassword,
    newPassword,
    sendCurrentPassword,
    expectedOk,
    expectedError,
  }) => {
    const { helpers, bindings } = await serve();
    const db = await bindings.database();

    const { user, client } = await helpers.createUser({
      email: `changepass-${Date.now()}@example.com`,
    });

    await db.updateUserByID({
      id: user.id,
      password: hasPassword ? await hash(currentPassword!, 10) : null,
      email_verified: new Date(),
    });

    let error: string | undefined;
    const data = await client.auth
      .changePassword({
        currentPassword: sendCurrentPassword,
        newPassword,
      })
      .catch((err) => {
        error = err instanceof Error ? err.message : "Unknown error";
      });

    if (expectedOk) {
      expect(data?.ok).toBe(true);
      // Verify password was actually changed
      const { compare } = await import("bcrypt-ts");
      const updatedUser = await db.selectUserByID(user.id);
      expect(await compare(newPassword, updatedUser!.password!)).toBe(true);
    }
    if (expectedError) {
      expect(error).toContain(expectedError);
    }
  }
);

test("POST /change-password without authentication returns unauthorized error", async () => {
  const { url } = await serve();

  const client = new Client({ baseURL: url.toString() });

  let error: string | undefined;
  await client.auth
    .changePassword({
      currentPassword: "oldpassword123",
      newPassword: "newpassword456",
    })
    .catch((err) => {
      error = err instanceof Error ? err.message : "Unknown error";
    });

  expect(error).toContain("Unauthorized");
});
