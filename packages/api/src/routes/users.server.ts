import * as convert from "@blink.so/database/convert";
import { validator } from "hono/validator";
import { validate } from "uuid";
import { withAuth } from "../middleware";
import type { APIServer } from "../server";
import { isUniqueConstraintError } from "../server-helper";
import { newApiKeyString } from "./api-keys.server";
import {
  schemaCreateApiKeyRequest,
  schemaUpdateUserRequest,
  type CreateApiKeyResponse,
  type ListApiKeysResponse,
} from "./users.client";

export default function mountUsers(server: APIServer) {
  // Get the current user.
  server.get("/me", withAuth, async (c) => {
    const db = await c.env.database();
    const user = await db.selectUserByID(c.get("user_id"));
    if (!user) {
      return c.json({ message: "User not found" }, 404);
    }
    return c.json(convert.user(user));
  });

  // Update the current user.
  server.patch(
    "/me",
    withAuth,
    validator("json", (value, c) => {
      return schemaUpdateUserRequest.parse(value);
    }),
    async (c) => {
      const db = await c.env.database();
      const userID = c.get("user_id");
      const { display_name, username, avatar_file_id } = c.req.valid("json");

      const user = await db.selectUserByID(userID);
      if (!user) {
        return c.json({ message: "User not found" }, 404);
      }

      try {
        // Update display name if provided
        if (display_name !== undefined) {
          await db.updateUserByID({
            id: userID,
            display_name: display_name || null,
          });
        }

        // Update avatar if provided (updates personal organization avatar)
        if (avatar_file_id !== undefined) {
          const newUrl =
            avatar_file_id && avatar_file_id.trim().length > 0
              ? `/api/files/${avatar_file_id.trim()}`
              : null;

          await db.updateOrganizationByID(user.organization_id, {
            avatar_url: newUrl,
          });
        }

        // Update username (personal organization name) if provided
        if (username !== undefined) {
          await db.updateOrganizationByID(user.organization_id, {
            name: username,
          });
        }

        // Fetch updated user
        const updatedUser = await db.selectUserByID(userID);
        if (!updatedUser) {
          return c.json({ message: "User not found after update" }, 404);
        }

        return c.json(convert.user(updatedUser));
      } catch (error) {
        // Check for unique constraint violations on organization name
        if (
          isUniqueConstraintError(error, "organization_name_unique") ||
          isUniqueConstraintError(error, "organization_lower_idx")
        ) {
          return c.json({ message: "Username is already taken" }, 400);
        }
        throw error;
      }
    }
  );

  // Get a user by ID.
  server.get("/:id", withAuth, async (c) => {
    const db = await c.env.database();
    const userID = c.req.param("id");
    if (!validate(userID)) {
      return c.json({ message: "Invalid user ID" }, 400);
    }
    const user = await db.selectUserByID(userID);
    if (!user) {
      return c.json({ message: "User not found" }, 404);
    }
    return c.json(convert.user(user));
  });

  // Get user accounts (OAuth providers) for current user.
  server.get("/me/accounts", withAuth, async (c) => {
    const db = await c.env.database();
    const userID = c.get("user_id");

    const [githubAccounts, googleAccounts] = await Promise.all([
      db.selectUserAccountsByProviderAndUserID("github", userID),
      db.selectUserAccountsByProviderAndUserID("google", userID),
    ]);

    return c.json({
      github: githubAccounts.map((a) => ({
        provider: "github" as const,
        provider_account_id: a.provider_account_id,
      })),
      google: googleAccounts.map((a) => ({
        provider: "google" as const,
        provider_account_id: a.provider_account_id,
      })),
    });
  });

  // Unlink OAuth provider for current user.
  server.delete("/me/accounts/:provider/:accountId", withAuth, async (c) => {
    const db = await c.env.database();
    const userID = c.get("user_id");
    const provider = c.req.param("provider") as "github" | "google";
    const providerAccountId = c.req.param("accountId");

    if (provider !== "github" && provider !== "google") {
      return c.json({ message: "Invalid provider" }, 400);
    }

    // Fetch user and all linked accounts to enforce safety
    const [user, githubAccounts, googleAccounts] = await Promise.all([
      db.selectUserByID(userID),
      db.selectUserAccountsByProviderAndUserID("github", userID),
      db.selectUserAccountsByProviderAndUserID("google", userID),
    ]);

    if (!user) {
      return c.json({ message: "User not found" }, 404);
    }

    // Verify the account to unlink belongs to this user
    const targetList = provider === "github" ? githubAccounts : googleAccounts;
    const target = targetList.find(
      (a) => a.provider_account_id === providerAccountId
    );
    if (!target) {
      return c.json({ message: "Account not found" }, 404);
    }

    // Prevent lockout: if user has no password and this is the last linked provider
    const totalLinked = githubAccounts.length + googleAccounts.length;
    if (!user.password && totalLinked <= 1) {
      return c.json(
        {
          message:
            "Set a password or link another provider before unlinking your last login method.",
        },
        400
      );
    }

    await db.deleteUserAccountByProviderAccountID({
      provider,
      provider_account_id: providerAccountId,
    });

    return c.body(null, 204);
  });

  // Delete current user account.
  server.delete("/me", withAuth, async (c) => {
    const db = await c.env.database();
    const userID = c.get("user_id");

    await db.deleteUserByID(userID);

    return c.body(null, 204);
  });

  server.get("/me/api-keys", withAuth, async (c) => {
    const userID = c.get("user_id");
    const db = await c.env.database();
    const apiKeys = await db.selectApiKeysByUserId(userID);
    return c.json({
      items: apiKeys.map((k) => ({
        id: k.id,
        user_id: k.user_id,
        name: k.name,
        key_lookup: k.key_lookup,
        key_prefix: k.key_prefix,
        key_suffix: k.key_suffix,
        scope: k.scope,
        expires_at: k.expires_at,
        last_used_at: k.last_used_at,
        created_at: k.created_at,
        updated_at: k.updated_at,
        revoked_at: k.revoked_at,
        revoked_by: k.revoked_by,
      })),
    } satisfies ListApiKeysResponse);
  });

  server.post(
    "/me/api-keys",
    withAuth,
    validator("json", (value, c) => {
      return schemaCreateApiKeyRequest.parse(value);
    }),
    async (c) => {
      const userID = c.get("user_id");
      const { name, expires_at } = c.req.valid("json");
      const db = await c.env.database();

      const { lookup, prefix, fullKey, hash } = await newApiKeyString(
        c.env.AUTH_SECRET
      );

      const apiKey = await db.insertApiKey({
        user_id: userID,
        name: name || "New API Key",
        key_hash: hash,
        key_lookup: lookup,
        key_prefix: prefix,
        key_suffix: fullKey.slice(-4),
        scope: "full",
        expires_at:
          expires_at || new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });

      return c.json({
        id: apiKey.id,
        user_id: apiKey.user_id,
        name: apiKey.name,
        key_lookup: apiKey.key_lookup,
        key_prefix: apiKey.key_prefix,
        key_suffix: apiKey.key_suffix,
        scope: apiKey.scope,
        expires_at: apiKey.expires_at,
        last_used_at: apiKey.last_used_at,
        created_at: apiKey.created_at,
        updated_at: apiKey.updated_at,
        revoked_at: apiKey.revoked_at,
        revoked_by: apiKey.revoked_by,
        key: fullKey,
      } satisfies CreateApiKeyResponse);
    }
  );

  server.delete("/me/api-keys/:key_id", withAuth, async (c) => {
    const keyId = c.req.param("key_id");
    const { z } = await import("zod");
    const parsed = await z.uuid().safeParseAsync(keyId);
    if (!parsed.success) {
      return c.json({ message: "Invalid API Key ID" }, 400);
    }
    const userID = c.get("user_id");
    const db = await c.env.database();
    const apiKey = await db.selectApiKeyByID(keyId);
    if (
      !apiKey ||
      apiKey.revoked_at ||
      (apiKey.expires_at &&
        apiKey.expires_at.getTime() < new Date().getTime()) ||
      apiKey.user_id !== userID
    ) {
      return c.json({ message: "API key not found" }, 404);
    }
    await db.updateApiKey(keyId, {
      revoked_at: new Date(),
      revoked_by: userID,
    });
    return c.body(null, 204);
  });
}
