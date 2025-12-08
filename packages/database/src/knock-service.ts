/**
 * Simple Knock.app API integration
 * Handles user identification and notification setup
 */

export interface KnockUser {
  id: string;
  email?: string | null;
  name?: string | null;
  properties?: Record<string, any>;
}

export interface KnockTenant {
  id: string;
  name?: string;
  properties?: Record<string, any>;
}

export class KnockService {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || "https://api.knock.app";
  }

  /**
   * Identify a user in Knock
   *
   * Note: We intentionally do NOT include team_id/team_name in user properties
   * since users can belong to multiple teams. Team relationships are managed via:
   * 1. Tenant scoping when triggering workflows
   * 2. Database team_membership table for authoritative team relationships
   * 3. Knock tenants for notification scoping (not user properties)
   */
  async identifyUser(user: KnockUser): Promise<void> {
    if (!user.id) {
      throw new Error("User ID is required for Knock identification");
    }

    if (!this.apiKey) {
      return;
    }

    const payload = {
      id: user.id,
      ...(user.email && { email: user.email }),
      ...(user.name && { name: user.name }),
      ...(user.properties && { properties: user.properties }),
    };

    try {
      const response = await fetch(`${this.baseUrl}/v1/users/${user.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Knock API error: ${response.status} ${errorText}`);
      }
    } catch (error) {
      // Log error but don't throw to avoid breaking user creation
      console.error("Failed to identify user in Knock:", error, this.apiKey);
    }
  }

  /**
   * Merge two user records (e.g., invited user with registered user)
   */
  async mergeUsers(
    primaryUserId: string,
    secondaryUserId: string
  ): Promise<void> {
    if (!primaryUserId || !secondaryUserId) {
      throw new Error(
        "Both primary and secondary user IDs are required for merge"
      );
    }

    if (!this.apiKey) {
      return;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/v1/users/${primaryUserId}/merge`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from_user_id: secondaryUserId,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Knock API error: ${response.status} ${errorText}`);
      }
    } catch (error) {
      // Log error but don't throw to avoid breaking OAuth flow
      console.error("Failed to merge users in Knock:", error);
    }
  }

  /**
   * Delete a user from Knock
   */
  async deleteUser(userId: string): Promise<void> {
    if (!userId) {
      throw new Error("User ID is required for deletion");
    }

    if (!this.apiKey) {
      return;
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/users/${userId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Knock API error: ${response.status} ${errorText}`);
      }
    } catch (error) {
      // Log error but don't throw to avoid breaking user deletion
      console.error("Failed to delete user in Knock:", error);
    }
  }

  /**
   * Create or update a tenant in Knock
   */
  async createTenant(tenant: KnockTenant): Promise<void> {
    console.log("[KNOCK DEBUG] createTenant called with:", {
      tenantId: tenant.id,
      tenantName: tenant.name,
      hasApiKey: !!this.apiKey,
      apiKeyPrefix: this.apiKey ? this.apiKey.substring(0, 10) + "..." : "none",
      baseUrl: this.baseUrl,
    });

    if (!tenant.id) {
      const error = "Tenant ID is required";
      console.log("[KNOCK DEBUG] createTenant failed:", error);
      throw new Error(error);
    }

    if (!this.apiKey) {
      console.log("[KNOCK DEBUG] createTenant skipped: no API key");
      return;
    }

    const payload = {
      id: tenant.id,
      ...(tenant.name && { name: tenant.name }),
      ...(tenant.properties && { properties: tenant.properties }),
    };

    console.log(
      "[KNOCK DEBUG] createTenant payload:",
      JSON.stringify(payload, null, 2)
    );

    try {
      const url = `${this.baseUrl}/v1/tenants/${tenant.id}`;
      console.log("[KNOCK DEBUG] createTenant making PUT request to:", url);

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      console.log("[KNOCK DEBUG] createTenant response:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType: response.headers.get("content-type"),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMessage = `Knock API error: ${response.status} ${errorText}`;
        console.log("[KNOCK DEBUG] createTenant API error:", errorMessage);
        throw new Error(errorMessage);
      }

      const responseText = await response.text();
      console.log("[KNOCK DEBUG] createTenant success response:", responseText);
    } catch (error) {
      console.error("[KNOCK DEBUG] createTenant caught error:", error);
      // Log error but don't throw to avoid breaking tenant creation
      console.error("Failed to create tenant in Knock:", error);
    }
  }

  /**
   * Add subscriptions to an object in Knock
   */
  async addObjectSubscriptions(
    collection: string,
    objectId: string,
    recipients: string[]
  ): Promise<void> {
    console.log("[KNOCK DEBUG] addObjectSubscriptions called with:", {
      collection,
      objectId,
      recipients,
      recipientCount: recipients.length,
      hasApiKey: !!this.apiKey,
      apiKeyPrefix: this.apiKey ? this.apiKey.substring(0, 10) + "..." : "none",
      baseUrl: this.baseUrl,
    });

    if (!collection || !objectId || !recipients.length) {
      const error = "Collection, object ID, and recipients are required";
      console.log("[KNOCK DEBUG] addObjectSubscriptions failed:", error);
      throw new Error(error);
    }

    if (!this.apiKey) {
      console.log("[KNOCK DEBUG] addObjectSubscriptions skipped: no API key");
      return;
    }

    const validRecipients = recipients.filter(
      (id) => typeof id === "string" && id.trim().length > 0
    );

    console.log("[KNOCK DEBUG] addObjectSubscriptions filtered recipients:", {
      original: recipients,
      valid: validRecipients,
      filtered: recipients.length - validRecipients.length,
    });

    if (validRecipients.length === 0) {
      console.warn(
        "[KNOCK DEBUG] addObjectSubscriptions: No valid recipients provided for object subscription"
      );
      console.warn("No valid recipients provided for object subscription");
      return;
    }

    const payload = {
      recipients: validRecipients,
    };

    try {
      const url = `${this.baseUrl}/v1/objects/${collection}/${objectId}/subscriptions`;
      console.log(
        "[KNOCK DEBUG] addObjectSubscriptions making POST request to:",
        url
      );
      console.log(
        "[KNOCK DEBUG] addObjectSubscriptions payload:",
        JSON.stringify(payload, null, 2)
      );

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      console.log("[KNOCK DEBUG] addObjectSubscriptions response:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType: response.headers.get("content-type"),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMessage = `Knock API error: ${response.status} ${errorText}`;
        console.log(
          "[KNOCK DEBUG] addObjectSubscriptions API error:",
          errorMessage
        );
        throw new Error(errorMessage);
      }

      const responseText = await response.text();
      console.log(
        "[KNOCK DEBUG] addObjectSubscriptions success response:",
        responseText
      );
    } catch (error) {
      console.error(
        "[KNOCK DEBUG] addObjectSubscriptions caught error:",
        error
      );
      // Log error but don't throw to avoid breaking subscription flow
      console.error("Failed to add object subscriptions in Knock:", error);
    }
  }

  /**
   * Remove subscriptions from an object in Knock
   */
  async removeObjectSubscriptions(
    collection: string,
    objectId: string,
    recipients: string[]
  ): Promise<void> {
    if (!collection || !objectId || !recipients.length) {
      throw new Error("Collection, object ID, and recipients are required");
    }

    if (!this.apiKey) {
      return;
    }

    const validRecipients = recipients.filter(
      (id) => typeof id === "string" && id.trim().length > 0
    );
    if (validRecipients.length === 0) {
      console.warn("No valid recipients provided for object unsubscription");
      return;
    }

    const payload = {
      recipients: validRecipients,
    };

    try {
      const response = await fetch(
        `${this.baseUrl}/v1/objects/${collection}/${objectId}/subscriptions`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Knock API error: ${response.status} ${errorText}`);
      }
    } catch (error) {
      // Log error but don't throw to avoid breaking unsubscription flow
      console.error("Failed to remove object subscriptions in Knock:", error);
    }
  }

  /**
   * Set an object in Knock with properties
   */
  async setObject(
    collection: string,
    objectId: string,
    properties: Record<string, any>
  ): Promise<void> {
    console.log("[KNOCK DEBUG] setObject called with:", {
      collection,
      objectId,
      properties: JSON.stringify(properties, null, 2),
      hasApiKey: !!this.apiKey,
      apiKeyPrefix: this.apiKey ? this.apiKey.substring(0, 10) + "..." : "none",
      baseUrl: this.baseUrl,
    });

    if (!collection || !objectId) {
      const error = "Collection and object ID are required";
      console.log("[KNOCK DEBUG] setObject failed:", error);
      throw new Error(error);
    }

    if (!this.apiKey) {
      console.log("[KNOCK DEBUG] setObject skipped: no API key");
      return;
    }

    try {
      const url = `${this.baseUrl}/v1/objects/${collection}/${objectId}`;
      console.log("[KNOCK DEBUG] setObject making PUT request to:", url);
      console.log(
        "[KNOCK DEBUG] setObject payload:",
        JSON.stringify(properties, null, 2)
      );

      const response = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(properties),
      });

      console.log("[KNOCK DEBUG] setObject response:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        contentType: response.headers.get("content-type"),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorMessage = `Knock API error: ${response.status} ${errorText}`;
        console.log("[KNOCK DEBUG] setObject API error:", errorMessage);
        throw new Error(errorMessage);
      }

      const responseText = await response.text();
      console.log("[KNOCK DEBUG] setObject success response:", responseText);
    } catch (error) {
      console.error("[KNOCK DEBUG] setObject caught error:", error);
      // Log error but don't throw to avoid breaking object creation
      console.error("Failed to set object in Knock:", error);
    }
  }

  /**
   * Delete a tenant in Knock
   */
  async deleteTenant(tenantId: string): Promise<void> {
    if (!tenantId) {
      throw new Error("Tenant ID is required");
    }

    if (!this.apiKey) {
      return;
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/tenants/${tenantId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Knock API error: ${response.status} ${errorText}`);
      }
    } catch (error) {
      // Log error but don't throw to avoid breaking team deletion flow
      console.error("Failed to delete tenant in Knock:", error);
    }
  }

  /**
   * Delete an object in Knock
   */
  async deleteObject(collection: string, objectId: string): Promise<void> {
    if (!collection || !objectId) {
      throw new Error("Collection and object ID are required");
    }

    if (!this.apiKey) {
      return;
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/v1/objects/${collection}/${objectId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Knock API error: ${response.status} ${errorText}`);
      }
    } catch (error) {
      // Log error but don't throw to avoid breaking team deletion flow
      console.error("Failed to delete object in Knock:", error);
    }
  }

  /**
   * Trigger a workflow in Knock
   */
  async triggerWorkflow(
    workflowKey: string,
    recipients: Array<string | KnockUser | { collection: string; id: string }>,
    data: Record<string, any>,
    actor?: string,
    tenant?: string,
    options?: { idempotencyKey?: string }
  ): Promise<void> {
    if (!workflowKey) {
      throw new Error("Workflow key is required");
    }

    if (!recipients || recipients.length === 0) {
      throw new Error("At least one recipient is required");
    }

    if (!this.apiKey) {
      throw new Error("Knock service not configured - missing API key");
    }

    const payload = {
      recipients,
      data,
      ...(actor && { actor }),
      ...(tenant && { tenant }),
    };

    try {
      const response = await fetch(
        `${this.baseUrl}/v1/workflows/${workflowKey}/trigger`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...(options?.idempotencyKey
              ? { "Idempotency-Key": options.idempotencyKey }
              : {}),
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Knock workflow trigger error: ${response.status} ${errorText}`
        );
      }
    } catch (error) {
      // Log error but don't throw to avoid breaking core functionality
      console.error(
        `Failed to trigger Knock workflow '${workflowKey}':`,
        error
      );
    }
  }
}

// Simple singleton instance
let knockService: KnockService | null = null;

/**
 * Get the Knock service instance
 * Returns null if Knock is not configured
 */
export function getKnockService(): KnockService | null {
  if (knockService) {
    return knockService;
  }

  const apiKey = process.env.KNOCK_API_KEY;
  if (!apiKey) {
    return null;
  }

  const baseUrl = process.env.KNOCK_BASE_URL;
  knockService = new KnockService(apiKey, baseUrl);

  return knockService;
}
