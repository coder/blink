import { Webhooks, type EmitterWebhookEventName } from "@octokit/webhooks";

export interface WebhookOptions {
  /**
   * secret is a webhook secret for the GitHub App.
   * If not provided, the environment variable `GITHUB_WEBHOOK_SECRET` is used.
   */
  secret?: string;
}

/**
 * handleWebhook handles a GitHub webhook request.
 *
 * @param request - The request to handle.
 * @returns A response to the request.
 */
export async function handleWebhook(
  request: Request,
  options?: WebhookOptions
): Promise<Response> {
  const [id, event, signature] = [
    request.headers.get("x-github-delivery"),
    request.headers.get("x-github-event"),
    request.headers.get("x-hub-signature-256"),
  ];
  if (!signature || !id || !event) {
    return new Response("Unauthorized", { status: 401 });
  }
  const secret = options?.secret ?? process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "You must specify a secret in the options or the environment variable `GITHUB_WEBHOOK_SECRET`."
    );
  }
  const webhooks = new Webhooks({
    secret,
  });
  await webhooks.verifyAndReceive({
    id,
    name: event as EmitterWebhookEventName,
    payload: await request.text(),
    signature,
  });
  return new Response("OK", { status: 200 });
}
