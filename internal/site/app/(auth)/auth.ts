import { getQuerier } from "@/lib/database";
import { getKnockService } from "@blink.so/database/knock-service";
import { decode, encode } from "next-auth/jwt";
import { cookies } from "next/headers";

// Auth constants
const SESSION_COOKIE_NAME = "blink_session_token";
const SESSION_SECURE = false;

declare module "next-auth" {
  interface Session {
    user?: {
      id: string;
      email?: string;
      name?: string;
      image?: string | null;
      organization_id?: string;
    };
    expires: string;
  }

  interface User {
    id?: string;
    email?: string | null;
    name?: string;
    organization_id?: string;
  }
}

/**
 * Server-side auth helper function that decodes session from cookies.
 * This replaces the NextAuth auth() function.
 */
export async function auth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  try {
    const decoded = await decode({
      token,
      secret: process.env.AUTH_SECRET!,
      salt: SESSION_COOKIE_NAME,
    });

    if (!decoded?.id) return null;

    return {
      user: {
        id: decoded.id as string,
        email: decoded.email as string,
        name: decoded.name as string,
        image: decoded.avatar_url as string | null,
        organization_id: decoded.organization_id as string | undefined,
      },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Client-side signOut stub - calls API endpoint.
 */
export async function signOut(options?: {
  redirect?: boolean;
  redirectTo?: string;
}) {
  if (typeof window !== "undefined") {
    await fetch("/api/auth/signout", { method: "POST" });
    if (options?.redirect !== false) {
      window.location.href = options?.redirectTo || "/";
    }
  }
}

// generateEmailVerificationToken generates a token and code for email verification.
export const generateEmailVerificationToken = async (
  email: string,
  workflow: "validate-email" | "reset-password" = "validate-email"
): Promise<{
  token: string;
  code: string;
}> => {
  const querier = await getQuerier();
  const code = Math.floor(100000000 + Math.random() * 900000000).toString();

  // if (process.env.NODE_ENV === "development") {
  console.log(`====================`);
  console.log(`Generating email verification token for ${email}`);
  console.log(`Code: ${code}`);
  console.log(`====================`);
  // }

  await querier.insertEmailVerification({
    email,
    code,
    expiresAt: new Date(Date.now() + 1000 * 60 * 15),
  });
  const token = await encode({
    secret: process.env.AUTH_SECRET as string,
    salt: "email-verification",
    token: {
      id: crypto.randomUUID(),
      email,
    },
  });

  const knock = getKnockService();
  if (knock) {
    const user = await querier.selectUserByEmail(email);
    if (!user) {
      // For password reset workflows, gracefully handle non-existent users
      // by not sending an email but still returning a token (for security)
      if (workflow === "reset-password") {
        // Don't send email, but return success to avoid revealing user existence
        return {
          token,
          code,
        };
      }
      // For other workflows (like email validation), still throw an error
      throw new Error("User not found");
    }
    // Trigger the requested workflow with the generated code
    await knock.triggerWorkflow(
      workflow,
      [
        {
          id: user.id,
          email,
          name: user.display_name,
        },
      ],
      {
        code,
      }
    );
  }

  return {
    token,
    code,
  };
};

export const decodeEmailVerificationToken = async (
  token: string
): Promise<
  | {
      email: string;
    }
  | undefined
> => {
  const decoded = await decode({
    secret: process.env.AUTH_SECRET as string,
    salt: "email-verification",
    token,
  });
  if (!decoded?.email) {
    return undefined;
  }
  return {
    email: decoded.email,
  };
};

export const emailVerificationTokenCookieName = "email_verification_token";

// Helper cookies and tokens for password reset finalization
export const passwordResetVerifiedCookieName = "password_reset_verified";

export const decodePasswordResetVerifiedToken = async (
  token: string
): Promise<
  | {
      email: string;
    }
  | undefined
> => {
  const decoded = await decode({
    secret: process.env.AUTH_SECRET as string,
    salt: "password-reset-verified",
    token,
  });
  if (!decoded?.email) {
    return undefined;
  }
  return { email: decoded.email };
};
