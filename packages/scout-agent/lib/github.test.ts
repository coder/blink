import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import * as crypto from "node:crypto";
import type {
  EmitterWebhookEvent,
  EmitterWebhookEventName,
} from "@octokit/webhooks";
import type { UIMessage } from "ai";
import * as blink from "blink";
import { HttpResponse, http as mswHttp } from "msw";
import { setupServer } from "msw/node";
import {
  createGitHubTools,
  githubAppContextFactory,
  handleGitHubWebhook,
} from "./github";
import {
  createMockBlinkApiServer,
  noopLogger,
  withBlinkApiUrl,
  withEnvVariable,
} from "./test-helpers";

// Extract the payload type from EmitterWebhookEvent
type WebhookPayload<TEvent extends EmitterWebhookEventName> =
  EmitterWebhookEvent<TEvent>["payload"];

// For testing, we use partial payloads since we only need specific fields.
// This type:
// - Makes all properties optional (deep partial)
// - Widens string literals to string for easier test writing
// - Does NOT allow extra properties not in the original type
type DeepPartialForTest<T> = T extends string
  ? string
  : T extends object
    ? { [P in keyof T]?: DeepPartialForTest<T[P]> }
    : T;

// Recursively extracts keys from U that don't exist in T.
// Returns never if there are no extra keys, otherwise returns the extra key names.
// Properly handles arrays by recursing into item types.
type ExtraKeysDeep<T, U> = U extends readonly (infer UItem)[]
  ? T extends readonly (infer TItem)[]
    ? ExtraKeysDeep<TItem, UItem>
    : "array_type_mismatch"
  : U extends object
    ? {
        [K in keyof U]: K extends keyof T
          ? T[K] extends object
            ? U[K] extends object
              ? ExtraKeysDeep<T[K], U[K]>
              : never
            : never
          : K;
      }[keyof U]
    : never;

// Validated payload type: resolves to TPayload if valid, or an error message type if not.
// This works even when payload is assigned to a variable first.
type ValidatedPayload<TEvent extends EmitterWebhookEventName, TPayload> =
  ExtraKeysDeep<WebhookPayload<TEvent>, TPayload> extends never
    ? TPayload
    : `Error: Payload has extra properties not in ${TEvent} webhook type`;

// MSW server for mocking GitHub API
const mswServer = setupServer();

// Valid test RSA private key (PKCS#8 format) for GitHub App authentication tests
const TEST_RSA_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDUJlkkJxjt4Hhq
62jt47jvKXtL7v/bMT82exC2cdw0piVAEHOcnwtn2nu6atfdf0o94TS9Q6ZkkBC/
pQhWYWDGMaFptHmQwB+K/jZiaP/GHsn2VIC9u8v2PnsUwqdpmmnVeX8WqnDQqlUJ
ZzJJn+phw0Cirn8YoPkw4XcXRS9a+g4YzOyFO7hoAu/cxrhpsIT39Y20U5oqNWja
nlt/hH92y4lTywC+5dIO63gDJvwnXsPJAH+bjhvPuplQxOWoCMDeoLuEUXR3FxdW
PA5TusB7xhjJipiS9x/j1zhSU5YFADBK7RBxlW0SqNBDAR5U8MzpBS/TGk3W7TL+
0bMELt6dAgMBAAECggEADBmaKiL1u8mQAgR7wge5P6DQI2MAt6XYgGO8BAqR9UnI
TvNb7gyvMppGRiS7u6p7157YP8w+Obby0ZoY0+PEHdcXqPxYwP4IPoikcu/2A1I0
Ztw9JzUxG1Icedu7/zIGA8g6d1aQzoH3OCz+iVmkMrUXeGqMnWEUXWqap4U0FSjv
3mAKzQ7FgbUdozUQs6blrrwjAA2dzBsUMLocdMc054Gthii4dVbvXt+THB6+0RtM
5/DN68BDGE00mD0amAE7ZiU4B9yTkQS46scofctlX6OroGDxaXGtXIAZ30e8AWOH
yWMo2r8XPOrCD/P8DZCIlu2jH2d9k5eQTbLvqAchEQKBgQDqtbKq4kuUKjON/120
tFnCYdi7YSoEs8l0mCzuiTItuYQ0UED7DnZ1CF2t17DMi+a/VAb6uASC67NXSRrm
/1ej1mHLpvW26RtU8d+VVkssOY5Qm30ggVrJz+BwngSH3nFSkZT8jDDkhyju68R3
AHRephJLTlPvQlhv/2kNBTl78QKBgQDnZMZzNufckiTUs6XHyL+QEtib9KosYc9N
pKOUf5ZsVQSlaXort+hNqFj5yJ8bE7IvZLYuxJSAwv8zXbXjh9APJLSnl/ZAuWbZ
dINsaJ7dJNbqu+5JkWKF/txtSU0rX/cTIH7RvO6NtxYXbmqrx0DmIN9KVWtnBvfb
z+QD9ROpbQKBgAhCMHE22TXzbjD25VMwbWAblUaymonj0ZjaqeoSxcM6Hd7BXCf5
UE2556HwTvZDjfD5ge1cgDwjEwJlPh8WqPzI1FQYIdk3xpBsmlNk3+xEci9/6R01
r/4d5GXSCZLGTvJ60OU6AZZo8xXFEfql93JFIauoq+dlTDtUn1un7WfhAoGAAUHG
4jFWKRiSIqWnLOKmR74SdyZpFjyhx6YxTUk0I/qCP/PGuh4RoPpdIV45nwgIW8GM
S8y9kcV9ZWYI6ud99dcZNB/bMpbPPDcpz5jx4/mjQTssHDIx+tBbmixfwvCOgwgW
KEWCdjqcYBw1cCFw9M8Q53J3VuPuzL7gWjUmmjECgYEA3qdAJzGW1G6kTqCjGTMy
YfM36t6DoPLz293LuJLw/wQhyQfJMQGguEh9igV237984U+D5QWUNagnGbxVr9kf
tEhRymQLvOolNCDesb2DWI9JVPFhZhIXp8xP8OptEolcXCRMpMtdNw8B2I+FSBTj
WVxArWQ+UmOCFNriuaJZJSs=
-----END PRIVATE KEY-----`;

const TEST_RSA_PRIVATE_KEY_BASE64 =
  Buffer.from(TEST_RSA_PRIVATE_KEY).toString("base64");

beforeAll(() => mswServer.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());

// Helper to compute GitHub webhook signature
const computeWebhookSignature = (payload: string, secret: string): string => {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
};

/**
 * Helper to create a typed webhook request for testing.
 *
 * Uses strict typing to:
 * - Allow partial payloads (only specify fields needed for the test)
 * - Provide autocomplete for valid payload fields
 * - Error on extra properties not in the webhook payload type
 *
 * @example
 * // TypeScript will suggest pull_request payload fields
 * createWebhookRequest("pull_request", {
 *   action: "closed",
 *   pull_request: { id: 123, merged: true }
 * }, secret)
 *
 * // This would cause a type error (extraField doesn't exist):
 * createWebhookRequest("pull_request", {
 *   action: "opened",
 *   extraField: "not allowed"  // Error!
 * }, secret)
 *
 * // Also works when payload is a variable:
 * const payload = { action: "opened", extraField: "bad" };
 * createWebhookRequest("pull_request", payload, secret)  // Error!
 */
const createWebhookRequest = <
  TEvent extends EmitterWebhookEventName,
  const TPayload extends DeepPartialForTest<WebhookPayload<TEvent>>,
>(
  event: TEvent,
  payload: ValidatedPayload<TEvent, TPayload>,
  secret: string,
  options?: {
    omitSignature?: boolean;
    omitDelivery?: boolean;
    omitEvent?: boolean;
  }
): Request => {
  // Cast to unknown to avoid strict literal type checking on action fields
  const body = JSON.stringify(payload as unknown);
  const headers: Record<string, string> = {};

  if (!options?.omitDelivery) {
    headers["x-github-delivery"] = crypto.randomUUID();
  }
  if (!options?.omitEvent) {
    // Extract the base event name (e.g., "check_run" from "check_run.completed")
    // biome-ignore lint/style/noNonNullAssertion: split always returns at least one element
    const baseEvent = event.includes(".") ? event.split(".")[0]! : event;
    headers["x-github-event"] = baseEvent;
  }
  if (!options?.omitSignature) {
    headers["x-hub-signature-256"] = computeWebhookSignature(body, secret);
  }
  headers["content-type"] = "application/json";

  return new Request("http://localhost/webhook", {
    method: "POST",
    headers,
    body,
  });
};

// Compile-time verification: extra properties cause type errors even with variables
const _payloadWithExtraField = { action: "opened", extraField: "bad" };
// @ts-expect-error extraField is not a valid property in pull_request payload
createWebhookRequest("pull_request", _payloadWithExtraField, "secret");

const withGitHubBotLogin = (login: string) => {
  return withEnvVariable("GITHUB_BOT_LOGIN", login);
};

const makeGithubAppContext = (args: { appId: string; privateKey: string }) => {
  return {
    appId: args.appId,
    privateKey: Buffer.from(args.privateKey, "base64").toString("utf-8"),
  };
};

describe("defaultGetGithubAppContextFactory", () => {
  test("decodes base64 private key", async () => {
    const privateKey =
      "-----BEGIN RSA PRIVATE KEY-----\nmy-private-key\n-----END RSA PRIVATE KEY-----";
    const base64Key = Buffer.from(privateKey).toString("base64");

    const result = await githubAppContextFactory({
      appId: "app-123",
      privateKey: base64Key,
    })();

    expect(result.appId).toBe("app-123");
    expect(result.privateKey).toBe(privateKey);
  });

  test("handles empty private key", async () => {
    const base64Key = Buffer.from("").toString("base64");

    const result = await githubAppContextFactory({
      appId: "app-456",
      privateKey: base64Key,
    })();

    expect(result.appId).toBe("app-456");
    expect(result.privateKey).toBe("");
  });

  test("handles multiline private key", async () => {
    const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF
SomeMoreBase64Content
-----END RSA PRIVATE KEY-----`;
    const base64Key = Buffer.from(privateKey).toString("base64");

    const result = await githubAppContextFactory({
      appId: "app-789",
      privateKey: base64Key,
    })();

    expect(result.appId).toBe("app-789");
    expect(result.privateKey).toBe(privateKey);
  });
});

describe("createGitHubTools", () => {
  test("returns tools with github_ prefix", () => {
    using apiServer = createMockBlinkApiServer();
    using _env = withBlinkApiUrl(apiServer.url);

    const agent = new blink.Agent<UIMessage>();
    const tools = createGitHubTools({
      agent,
      chatID: "test-chat-id" as blink.ID,
      githubAppContext: makeGithubAppContext({
        appId: "app-id",
        privateKey: Buffer.from("key").toString("base64"),
      }),
    });

    // Check that tools are prefixed
    const toolNames = Object.keys(tools);
    expect(toolNames.length).toBeGreaterThan(0);

    // All tools should start with github_
    for (const name of toolNames) {
      expect(name.startsWith("github_")).toBe(true);
    }

    // Should have the custom create_pull_request
    expect(tools.github_create_pull_request).toBeDefined();
  });

  test("github_create_pull_request stores PR association in agent store", async () => {
    using apiServer = createMockBlinkApiServer();
    using _env = withBlinkApiUrl(apiServer.url);

    // Mock GitHub API - need to mock both app installation and PR creation
    mswServer.use(
      mswHttp.get("https://api.github.com/app/installations", () => {
        return HttpResponse.json([
          { id: 12345, account: { login: "test-org" } },
        ]);
      }),
      mswHttp.post(
        "https://api.github.com/app/installations/:id/access_tokens",
        () => {
          return HttpResponse.json({
            token: "test-token",
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          });
        }
      ),
      mswHttp.post("https://api.github.com/repos/:owner/:repo/pulls", () => {
        return HttpResponse.json({
          id: 98765,
          node_id: "PR_kwDOtest123",
          number: 42,
          title: "Test PR",
          body: "Test body",
          state: "open",
          comments: 0,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          user: { login: "test-user" },
          head: { ref: "feature-branch", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
          merged_at: null,
          merge_commit_sha: null,
          merged_by: null,
          review_comments: 0,
          additions: 10,
          deletions: 5,
          changed_files: 2,
        });
      })
    );

    const agent = new blink.Agent<UIMessage>();
    const chatID = "test-chat-123" as blink.ID;
    const tools = createGitHubTools({
      agent,
      chatID,
      githubAppContext: makeGithubAppContext({
        appId: "12345",
        privateKey: TEST_RSA_PRIVATE_KEY_BASE64,
      }),
    });

    // Execute the tool
    // biome-ignore lint/style/noNonNullAssertion: tool is defined in test setup
    const result = await tools.github_create_pull_request!.execute!(
      {
        owner: "test-owner",
        repo: "test-repo",
        base: "main",
        head: "feature-branch",
        title: "Test PR",
        body: "Test body",
      },
      {
        abortSignal: new AbortController().signal,
        toolCallId: "test-tool-call",
        messages: [],
      }
    );

    // Verify the result shape
    expect(result).toHaveProperty("pull_request");
    // biome-ignore lint/suspicious/noExplicitAny: test assertion
    const pr = (result as any).pull_request;
    expect(pr.number).toBe(42);
    expect(pr.title).toBe("Test PR");
    expect(pr.head.ref).toBe("feature-branch");
    expect(pr.base.ref).toBe("main");

    // Verify PR associations were stored
    expect(apiServer.storage["chat-id-for-pr-98765"]).toBe(chatID);
    expect(apiServer.storage["chat-id-for-pr-PR_kwDOtest123"]).toBe(chatID);
  });

  test("github_create_pull_request returns correct response shape", async () => {
    using apiServer = createMockBlinkApiServer();
    using _env = withBlinkApiUrl(apiServer.url);

    mswServer.use(
      mswHttp.get("https://api.github.com/app/installations", () => {
        return HttpResponse.json([
          { id: 12345, account: { login: "test-org" } },
        ]);
      }),
      mswHttp.post(
        "https://api.github.com/app/installations/:id/access_tokens",
        () => {
          return HttpResponse.json({
            token: "test-token",
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          });
        }
      ),
      mswHttp.post("https://api.github.com/repos/:owner/:repo/pulls", () => {
        return HttpResponse.json({
          id: 111,
          node_id: "PR_node_111",
          number: 99,
          title: "Full PR",
          body: "Full body",
          state: "open",
          comments: 5,
          created_at: "2024-06-01T12:00:00Z",
          updated_at: "2024-06-01T13:00:00Z",
          user: { login: "author" },
          head: { ref: "my-feature", sha: "head-sha-123" },
          base: { ref: "develop", sha: "base-sha-456" },
          merged_at: "2024-06-02T00:00:00Z",
          merge_commit_sha: "merge-sha-789",
          merged_by: {
            login: "merger",
            avatar_url: "https://avatar.url",
            html_url: "https://github.com/merger",
          },
          review_comments: 3,
          additions: 100,
          deletions: 50,
          changed_files: 10,
        });
      })
    );

    const agent = new blink.Agent<UIMessage>();
    const tools = createGitHubTools({
      agent,
      chatID: "chat-id" as blink.ID,
      githubAppContext: makeGithubAppContext({
        appId: "12345",
        privateKey: TEST_RSA_PRIVATE_KEY_BASE64,
      }),
    });

    // biome-ignore lint/style/noNonNullAssertion: tool is defined in test setup
    const result = await tools.github_create_pull_request!.execute!(
      {
        owner: "owner",
        repo: "repo",
        base: "develop",
        head: "my-feature",
        title: "Full PR",
      },
      {
        abortSignal: new AbortController().signal,
        toolCallId: "test",
        messages: [],
      }
    );

    // biome-ignore lint/suspicious/noExplicitAny: test assertion
    const pr = (result as any).pull_request;
    expect(pr.number).toBe(99);
    expect(pr.comments).toBe(5);
    expect(pr.title).toBe("Full PR");
    expect(pr.body).toBe("Full body");
    expect(pr.state).toBe("open");
    expect(pr.created_at).toBe("2024-06-01T12:00:00Z");
    expect(pr.updated_at).toBe("2024-06-01T13:00:00Z");
    expect(pr.user.login).toBe("author");
    expect(pr.head.ref).toBe("my-feature");
    expect(pr.head.sha).toBe("head-sha-123");
    expect(pr.base.ref).toBe("develop");
    expect(pr.base.sha).toBe("base-sha-456");
    expect(pr.merged_at).toBe("2024-06-02T00:00:00Z");
    expect(pr.merge_commit_sha).toBe("merge-sha-789");
    expect(pr.merged_by.login).toBe("merger");
    expect(pr.merged_by.avatar_url).toBe("https://avatar.url");
    expect(pr.merged_by.html_url).toBe("https://github.com/merger");
    expect(pr.review_comments).toBe(3);
    expect(pr.additions).toBe(100);
    expect(pr.deletions).toBe(50);
    expect(pr.changed_files).toBe(10);
  });

  test("github_create_pull_request handles draft PRs", async () => {
    using apiServer = createMockBlinkApiServer();
    using _env = withBlinkApiUrl(apiServer.url);

    let capturedDraft: boolean | undefined;

    mswServer.use(
      mswHttp.get("https://api.github.com/app/installations", () => {
        return HttpResponse.json([{ id: 1 }]);
      }),
      mswHttp.post(
        "https://api.github.com/app/installations/:id/access_tokens",
        () => {
          return HttpResponse.json({
            token: "token",
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          });
        }
      ),
      mswHttp.post(
        "https://api.github.com/repos/:owner/:repo/pulls",
        async ({ request }) => {
          const body = await request.json();
          // biome-ignore lint/suspicious/noExplicitAny: test
          capturedDraft = (body as any).draft;
          return HttpResponse.json({
            id: 1,
            node_id: "PR_1",
            number: 1,
            title: "Draft PR",
            body: "",
            state: "open",
            comments: 0,
            created_at: "2024-01-01T00:00:00Z",
            updated_at: "2024-01-01T00:00:00Z",
            user: { login: "user" },
            head: { ref: "branch", sha: "sha" },
            base: { ref: "main", sha: "sha" },
            merged_at: null,
            merge_commit_sha: null,
            merged_by: null,
            review_comments: 0,
            additions: 0,
            deletions: 0,
            changed_files: 0,
          });
        }
      )
    );

    const agent = new blink.Agent<UIMessage>();
    const tools = createGitHubTools({
      agent,
      chatID: "chat" as blink.ID,
      githubAppContext: makeGithubAppContext({
        appId: "12345",
        privateKey: TEST_RSA_PRIVATE_KEY_BASE64,
      }),
    });

    // biome-ignore lint/style/noNonNullAssertion: tool is defined in test setup
    await tools.github_create_pull_request!.execute!(
      {
        owner: "owner",
        repo: "repo",
        base: "main",
        head: "branch",
        title: "Draft PR",
        draft: true,
      },
      {
        abortSignal: new AbortController().signal,
        toolCallId: "test",
        messages: [],
      }
    );

    expect(capturedDraft).toBe(true);
  });
});

describe("handleGitHubWebhook", () => {
  const webhookSecret = "test-webhook-secret";

  describe("header validation", () => {
    test("returns 401 when x-github-delivery header is missing", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const agent = new blink.Agent<UIMessage>();
      const request = createWebhookRequest("push", {}, webhookSecret, {
        omitDelivery: true,
      });

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(401);
      expect(await response.text()).toBe("Unauthorized");
    });

    test("returns 401 when x-github-event header is missing", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const agent = new blink.Agent<UIMessage>();
      const request = createWebhookRequest("push", {}, webhookSecret, {
        omitEvent: true,
      });

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(401);
    });

    test("returns 401 when x-hub-signature-256 header is missing", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const agent = new blink.Agent<UIMessage>();
      const request = createWebhookRequest("push", {}, webhookSecret, {
        omitSignature: true,
      });

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(401);
    });
  });

  describe("signature validation", () => {
    test("returns 500 when signature is invalid", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const agent = new blink.Agent<UIMessage>();
      const payload = { action: "opened" };
      const body = JSON.stringify(payload);

      const request = new Request("http://localhost/webhook", {
        method: "POST",
        headers: {
          "x-github-delivery": crypto.randomUUID(),
          "x-github-event": "push",
          "x-hub-signature-256": "sha256=invalid-signature",
          "content-type": "application/json",
        },
        body,
      });

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(500);
    });

    test("returns 200 when signature is valid", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const agent = new blink.Agent<UIMessage>();
      const payload = { action: "opened", pull_request: { id: 1 } };
      const request = createWebhookRequest(
        "pull_request",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("OK");
    });
  });

  describe("pull_request event", () => {
    test("sends message when PR is merged", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-for-merged-pr" as blink.ID;
      const prID = 12345;

      // Pre-populate store with PR association (raw value, not JSON stringified)
      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "closed",
        pull_request: {
          id: prID,
          merged: true,
          state: "closed",
          merged_at: "2024-01-01T00:00:00Z",
        },
      };
      const request = createWebhookRequest(
        "pull_request",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      expect(apiServer.sentMessages[0]!.chatId).toBe(chatID);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const message = apiServer.sentMessages[0]!.messages[0] as any;
      expect(message.role).toBe("user");
      expect(message.parts[0].text).toInclude("merged");
    });

    test("does not send message when PR is not merged", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-for-pr" as blink.ID;
      const prID = 12346;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "opened",
        pull_request: {
          id: prID,
          merged: false,
          state: "open",
        },
      };
      const request = createWebhookRequest(
        "pull_request",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });

    test("does not send message when PR is not associated with a chat", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "closed",
        pull_request: {
          id: 99999, // Not in store
          merged: true,
          state: "closed",
          merged_at: "2024-01-01T00:00:00Z",
        },
      };
      const request = createWebhookRequest(
        "pull_request",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });
  });

  describe("pull_request_review event", () => {
    test("sends message for review from non-bot user", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-for-review" as blink.ID;
      const prID = 22222;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "submitted",
        review: {
          id: 111,
          state: "changes_requested",
          body: "Please fix the tests",
          commit_id: "abc123",
        },
        pull_request: {
          id: prID,
        },
        sender: {
          login: "reviewer-human",
        },
      };
      const request = createWebhookRequest(
        "pull_request_review",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const message = apiServer.sentMessages[0]!.messages[0] as any;
      expect(message.parts[0].text).toInclude("reviewed");
      expect(message.parts[1].text).toInclude("changes_requested");
      expect(message.parts[1].text).toInclude("Please fix the tests");
    });

    test("skips review from bot user", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);
      using _botLogin = withGitHubBotLogin("my-bot[bot]");

      const chatID = "chat-for-bot-review" as blink.ID;
      const prID = 33333;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "submitted",
        review: {
          id: 222,
          state: "approved",
          body: "LGTM",
          commit_id: "def456",
        },
        pull_request: {
          id: prID,
        },
        sender: {
          login: "my-bot[bot]",
        },
      };
      const request = createWebhookRequest(
        "pull_request_review",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });

    test("handles review with no body", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-no-body" as blink.ID;
      const prID = 44444;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "submitted",
        review: {
          id: 333,
          state: "approved",
          body: null,
          commit_id: "ghi789",
        },
        pull_request: {
          id: prID,
        },
        sender: {
          login: "reviewer",
        },
      };
      const request = createWebhookRequest(
        "pull_request_review",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const message = apiServer.sentMessages[0]!.messages[0] as any;
      expect(message.parts[1].text).toInclude("No body provided");
    });
  });

  describe("pull_request_review_comment event", () => {
    test("sends message for comment from COLLABORATOR", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-collab-comment" as blink.ID;
      const prID = 55555;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "created",
        comment: {
          id: 444,
          body: "Nice code!",
          commit_id: "jkl012",
          author_association: "COLLABORATOR",
        },
        pull_request: {
          id: prID,
        },
        sender: {
          login: "collaborator-user",
        },
      };
      const request = createWebhookRequest(
        "pull_request_review_comment",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const message = apiServer.sentMessages[0]!.messages[0] as any;
      expect(message.parts[0].text).toInclude("comment");
      expect(message.parts[1].text).toInclude("Nice code!");
    });

    test("sends message for comment from MEMBER", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-member-comment" as blink.ID;
      const prID = 55556;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "created",
        comment: {
          id: 445,
          body: "From member",
          commit_id: "mem123",
          author_association: "MEMBER",
        },
        pull_request: {
          id: prID,
        },
        sender: {
          login: "member-user",
        },
      };
      const request = createWebhookRequest(
        "pull_request_review_comment",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
    });

    test("sends message for comment from OWNER", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-owner-comment" as blink.ID;
      const prID = 55557;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "created",
        comment: {
          id: 446,
          body: "From owner",
          commit_id: "own123",
          author_association: "OWNER",
        },
        pull_request: {
          id: prID,
        },
        sender: {
          login: "owner-user",
        },
      };
      const request = createWebhookRequest(
        "pull_request_review_comment",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
    });

    test("skips comment from non-authorized user (CONTRIBUTOR)", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-contributor-comment" as blink.ID;
      const prID = 66666;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "created",
        comment: {
          id: 555,
          body: "Random comment",
          commit_id: "mno345",
          author_association: "CONTRIBUTOR",
        },
        pull_request: {
          id: prID,
        },
        sender: {
          login: "random-contributor",
        },
      };
      const request = createWebhookRequest(
        "pull_request_review_comment",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });

    test("skips comment from NONE association", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-none-comment" as blink.ID;
      const prID = 66667;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "created",
        comment: {
          id: 556,
          body: "Spam",
          commit_id: "none123",
          author_association: "NONE",
        },
        pull_request: {
          id: prID,
        },
        sender: {
          login: "random-user",
        },
      };
      const request = createWebhookRequest(
        "pull_request_review_comment",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });

    test("skips comment from bot user", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);
      using _botLogin = withGitHubBotLogin("scout-bot[bot]");

      const chatID = "chat-bot-comment" as blink.ID;
      const prID = 77777;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "created",
        comment: {
          id: 666,
          body: "Bot comment",
          commit_id: "pqr678",
          author_association: "COLLABORATOR",
        },
        pull_request: {
          id: prID,
        },
        sender: {
          login: "scout-bot[bot]",
        },
      };
      const request = createWebhookRequest(
        "pull_request_review_comment",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });
  });

  describe("issue_comment event", () => {
    test("uses node_id for PR lookup (not id)", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-issue-comment" as blink.ID;
      const issueNodeId = "I_kwDOissue123";

      // Store by node_id, not id
      apiServer.storage[`chat-id-for-pr-${issueNodeId}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "created",
        comment: {
          id: 888,
          body: "Issue comment here",
          author_association: "MEMBER",
        },
        issue: {
          id: 99999, // Different from node_id
          node_id: issueNodeId,
        },
        sender: {
          login: "issue-commenter",
        },
      };
      const request = createWebhookRequest(
        "issue_comment",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const message = apiServer.sentMessages[0]!.messages[0] as any;
      expect(message.parts[0].text).toInclude("issue comment");
      expect(message.parts[1].text).toInclude("Issue comment here");
    });

    test("skips comment from non-authorized user", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-issue-unauthorized" as blink.ID;
      const issueNodeId = "I_unauth123";

      apiServer.storage[`chat-id-for-pr-${issueNodeId}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "created",
        comment: {
          id: 889,
          body: "Random comment",
          author_association: "FIRST_TIME_CONTRIBUTOR",
        },
        issue: {
          id: 88888,
          node_id: issueNodeId,
        },
        sender: {
          login: "first-timer",
        },
      };
      const request = createWebhookRequest(
        "issue_comment",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });

    test("skips comment from bot", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);
      using _botLogin = withGitHubBotLogin("issue-bot[bot]");

      const chatID = "chat-issue-bot" as blink.ID;
      const issueNodeId = "I_bot123";

      apiServer.storage[`chat-id-for-pr-${issueNodeId}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "created",
        comment: {
          id: 890,
          body: "Bot issue comment",
          author_association: "OWNER",
        },
        issue: {
          id: 77777,
          node_id: issueNodeId,
        },
        sender: {
          login: "issue-bot[bot]",
        },
      };
      const request = createWebhookRequest(
        "issue_comment",
        payload,
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });
  });

  describe("check_run.completed event", () => {
    test("sends message for failed check run", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-failed-check" as blink.ID;
      const prID = 111111;
      const headSha = "head-sha-match";

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "completed",
        check_run: {
          id: 999,
          status: "completed",
          conclusion: "failure",
          head_sha: headSha,
          pull_requests: [
            {
              id: prID,
              head: { sha: headSha },
            },
          ],
        },
      };
      const request = createWebhookRequest("check_run", payload, webhookSecret);

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
      // biome-ignore lint/suspicious/noExplicitAny: test assertion
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const message = apiServer.sentMessages[0]!.messages[0] as any;
      expect(message.parts[0].text).toInclude("check run");
      expect(message.parts[1].text).toInclude("failure");
    });

    test("ignores successful check run", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-success-check" as blink.ID;
      const prID = 222222;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "completed",
        check_run: {
          id: 1000,
          status: "completed",
          conclusion: "success",
          head_sha: "sha",
          pull_requests: [
            {
              id: prID,
              head: { sha: "sha" },
            },
          ],
        },
      };
      const request = createWebhookRequest("check_run", payload, webhookSecret);

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });

    test("ignores skipped check run", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-skipped-check" as blink.ID;
      const prID = 333333;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "completed",
        check_run: {
          id: 1001,
          status: "completed",
          conclusion: "skipped",
          head_sha: "sha",
          pull_requests: [
            {
              id: prID,
              head: { sha: "sha" },
            },
          ],
        },
      };
      const request = createWebhookRequest("check_run", payload, webhookSecret);

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });

    test("ignores check run with mismatched head sha (old check)", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-old-check" as blink.ID;
      const prID = 444444;

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "completed",
        check_run: {
          id: 1002,
          status: "completed",
          conclusion: "failure",
          head_sha: "old-sha",
          pull_requests: [
            {
              id: prID,
              head: { sha: "new-sha" }, // Different from check_run.head_sha
            },
          ],
        },
      };
      const request = createWebhookRequest("check_run", payload, webhookSecret);

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });

    test("sends messages for multiple PRs with matching sha", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID1 = "chat-multi-1" as blink.ID;
      const chatID2 = "chat-multi-2" as blink.ID;
      const prID1 = 555551;
      const prID2 = 555552;
      const headSha = "shared-sha";

      apiServer.storage[`chat-id-for-pr-${prID1}`] = JSON.stringify(chatID1);
      apiServer.storage[`chat-id-for-pr-${prID2}`] = JSON.stringify(chatID2);

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "completed",
        check_run: {
          id: 1003,
          status: "completed",
          conclusion: "failure",
          head_sha: headSha,
          pull_requests: [
            { id: prID1, head: { sha: headSha } },
            { id: prID2, head: { sha: headSha } },
          ],
        },
      };
      const request = createWebhookRequest("check_run", payload, webhookSecret);

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(2);
    });

    test("sends message for timed_out check run", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-timeout-check" as blink.ID;
      const prID = 666666;
      const headSha = "timeout-sha";

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "completed",
        check_run: {
          id: 1004,
          status: "completed",
          conclusion: "timed_out",
          head_sha: headSha,
          pull_requests: [{ id: prID, head: { sha: headSha } }],
        },
      };
      const request = createWebhookRequest("check_run", payload, webhookSecret);

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
    });

    test("sends message for cancelled check run", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const chatID = "chat-cancelled-check" as blink.ID;
      const prID = 777777;
      const headSha = "cancelled-sha";

      apiServer.storage[`chat-id-for-pr-${prID}`] = chatID;

      const agent = new blink.Agent<UIMessage>();
      const payload = {
        action: "completed",
        check_run: {
          id: 1005,
          status: "completed",
          conclusion: "cancelled",
          head_sha: headSha,
          pull_requests: [{ id: prID, head: { sha: headSha } }],
        },
      };
      const request = createWebhookRequest("check_run", payload, webhookSecret);

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(1);
    });
  });

  describe("pull_request_review_thread event", () => {
    test("handles resolved thread (no action taken)", async () => {
      using apiServer = createMockBlinkApiServer();
      using _env = withBlinkApiUrl(apiServer.url);

      const agent = new blink.Agent<UIMessage>();
      // Inline payload to preserve exact type for validation
      const request = createWebhookRequest(
        "pull_request_review_thread",
        {
          action: "resolved",
          thread: {
            node_id: "thread-123",
          },
          pull_request: {
            id: 88888,
          },
        },
        webhookSecret
      );

      const response = await handleGitHubWebhook({
        request,
        agent,
        githubWebhookSecret: webhookSecret,
        logger: noopLogger,
      });

      // Should succeed but not send any messages (no-op handler)
      expect(response.status).toBe(200);
      expect(apiServer.sentMessages.length).toBe(0);
    });
  });
});
