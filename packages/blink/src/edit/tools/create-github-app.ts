import { z } from "zod";
import http from "http";
import { createServerAdapter } from "@whatwg-node/server";

export interface GitHubAppData {
  id: number;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
  name: string;
  html_url: string;
  slug: string;
}

/**
 * Create GitHub App launches the user into the GitHub App creation flow
 * using a provided manifest.
 * @param manifest The GitHub App manifest configuration
 * @param organization Optional organization to create the app under
 * @param onComplete Callback when app creation completes or fails
 * @returns Promise that resolves with the server URL to visit
 */
export function createGithubApp(
  manifest: z.infer<typeof createGithubAppSchema>,
  organization?: string,
  onComplete?: (err: Error | null, data: GitHubAppData | null) => Promise<void>
): Promise<string> {
  let serverUrl: string;

  const server = http.createServer(
    createServerAdapter(async (req) => {
      const url = new URL(req.url, serverUrl);
      if (url.pathname !== "/") {
        // This handles like favicon.ico requests, etc.
        return new Response("Not found", { status: 404 });
      }

      const code = url.searchParams.get("code");

      // If we have a code, handle the callback
      if (code) {
        try {
          // Exchange the code for credentials
          const res = await fetch(
            `https://api.github.com/app-manifests/${code}/conversions`,
            {
              method: "POST",
              headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "blink.so",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            }
          );

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(
              `GitHub API error: ${res.status} ${res.statusText}${errorText ? ` - ${errorText}` : ""}`
            );
          }

          const data: GitHubAppData = await res.json();

          // Close the server and call the completion callback
          await onComplete?.(null, data);

          return new Response(
            `GitHub App created successfully! Return to your terminal to continue.`,
            {
              headers: { "Content-Type": "text/plain" },
            }
          );
        } catch (error) {
          let err = error instanceof Error ? error : new Error(String(error));

          try {
            await onComplete?.(err, null);
          } catch (error) {
            err = error instanceof Error ? error : new Error(String(error));
          }

          const errorMessage = err.message;

          return new Response(
            `Error: ${errorMessage}\n\nReturn to your terminal for more details.`,
            {
              status: 500,
              headers: { "Content-Type": "text/plain" },
            }
          );
        } finally {
          server.close();
        }
      }

      // Otherwise, serve the form
      const manifestWithRedirect = {
        ...manifest,
        redirect_url: serverUrl,
      };

      const baseUrl = organization
        ? `https://github.com/organizations/${organization}/settings/apps/new`
        : `https://github.com/settings/apps/new`;

      const html = `<!DOCTYPE html>
<html>
<body>
  <form id="f" method="POST" action="${baseUrl}">
    <input type="hidden" name="manifest" value='${JSON.stringify(manifestWithRedirect).replace(/'/g, "&#39;")}' />
  </form>
  <script>document.getElementById('f').submit()</script>
</body>
</html>`;

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    })
  );

  return new Promise<string>((resolve, reject) => {
    server.on("error", reject);

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      serverUrl = `http://127.0.0.1:${address.port}`;
      resolve(serverUrl);
    });
  });
}

// Permission access levels
const PermissionAccess = z.enum(["read", "write"]);

// Webhook events
const WebhookEvent = z.union([
  z
    .literal("branch_protection_rule")
    .describe("Branch protection rule created, edited, or deleted"),
  z.literal("check_run").describe("Check run created, completed, or requested"),
  z.literal("check_suite").describe("Check suite completed or requested"),
  z
    .literal("code_scanning_alert")
    .describe("Code scanning alert created, fixed, or reopened"),
  z.literal("commit_comment").describe("Commit comment created"),
  z.literal("create").describe("Branch or tag created"),
  z.literal("delete").describe("Branch or tag deleted"),
  z.literal("deployment").describe("Deployment created"),
  z.literal("deployment_status").describe("Deployment status created"),
  z
    .literal("deployment_protection_rule")
    .describe("Deployment protection rule requested"),
  z.literal("discussion").describe("Discussion created, edited, or deleted"),
  z
    .literal("discussion_comment")
    .describe("Discussion comment created, edited, or deleted"),
  z.literal("fork").describe("Repository forked"),
  z.literal("gollum").describe("Wiki page created or updated"),
  z
    .literal("issue_comment")
    .describe("Issue comment created, edited, or deleted"),
  z.literal("issues").describe("Issue opened, edited, closed, or labeled"),
  z.literal("label").describe("Label created, edited, or deleted"),
  z.literal("member").describe("Collaborator added, removed, or edited"),
  z.literal("membership").describe("Team membership added or removed"),
  z.literal("meta").describe("GitHub App webhook configuration changed"),
  z.literal("milestone").describe("Milestone created, closed, or deleted"),
  z
    .literal("organization")
    .describe("Organization member added, removed, or invited"),
  z.literal("org_block").describe("Organization blocked or unblocked a user"),
  z.literal("package").describe("Package published or updated"),
  z.literal("page_build").describe("GitHub Pages site built"),
  z.literal("project").describe("Project created, updated, or deleted"),
  z
    .literal("project_card")
    .describe("Project card created, edited, or deleted"),
  z
    .literal("project_column")
    .describe("Project column created, updated, or deleted"),
  z.literal("public").describe("Repository visibility changed to public"),
  z
    .literal("pull_request")
    .describe("Pull request opened, closed, edited, or synchronized"),
  z
    .literal("pull_request_review")
    .describe("Pull request review submitted, edited, or dismissed"),
  z
    .literal("pull_request_review_comment")
    .describe("Pull request review comment created or edited"),
  z
    .literal("pull_request_review_thread")
    .describe("Pull request review thread resolved or unresolved"),
  z.literal("push").describe("Git push to a repository"),
  z
    .literal("registry_package")
    .describe("Registry package published or updated"),
  z.literal("release").describe("Release published or edited"),
  z
    .literal("repository")
    .describe("Repository created, deleted, archived, or publicized"),
  z.literal("repository_dispatch").describe("Custom webhook event triggered"),
  z
    .literal("secret_scanning_alert")
    .describe("Secret scanning alert created or resolved"),
  z
    .literal("security_and_analysis")
    .describe("Security features enabled or disabled"),
  z.literal("star").describe("Repository starred or unstarred"),
  z.literal("status").describe("Commit status created"),
  z.literal("team").describe("Team created, deleted, or edited"),
  z.literal("team_add").describe("Repository added to team"),
  z.literal("watch").describe("User started watching repository"),
  z.literal("workflow_dispatch").describe("Workflow manually triggered"),
  z
    .literal("workflow_job")
    .describe("Workflow job queued, started, or completed"),
  z.literal("workflow_run").describe("Workflow run requested or completed"),
]);

export const createGithubAppSchema = z.object({
  name: z
    .string()
    .optional()
    .describe(
      "The name of the GitHub App. Leave blank to let the user name it on GitHub."
    ),
  url: z
    .url()
    .describe(
      "The homepage URL of the GitHub App. If unknown, set to https://blink.coder.com."
    ),
  description: z
    .string()
    .optional()
    .describe("The description of the GitHub App."),
  public: z
    .boolean()
    .optional()
    .describe(
      "Whether the GitHub App is public. Always default to false unless the user explicitly requests otherwise."
    ),

  // Webhook config
  hook_attributes: z
    .object({
      url: z.url(),
      active: z.boolean().optional().default(true),
    })
    .optional()
    .describe("The webhook configuration for the GitHub App."),

  callback_urls: z
    .array(z.url())
    .max(10)
    .optional()
    .describe(
      "Callback URLs for the GitHub App after the user authenticates with GitHub."
    ),

  setup_url: z
    .url()
    .optional()
    .describe(
      "The URL to redirect the user to after they install the GitHub App."
    ),
  setup_on_update: z
    .boolean()
    .optional()
    .describe(
      "Whether to redirect the user to the setup URL after an update to the installed app."
    ),
  request_oauth_on_install: z
    .boolean()
    .optional()
    .describe("Whether to request OAuth on install."),

  default_events: z
    .array(WebhookEvent)
    .optional()
    .describe("Webhook events sent to the webhook URL."),
  default_permissions: z
    .record(z.string(), PermissionAccess)
    .optional()
    .describe(
      "Repository and organization permissions for the GitHub App. Available permissions: actions (GitHub Actions workflows), administration (repository settings), checks (check runs), contents (repository code), deployments, environments, issues, metadata (always granted), packages, pages, pull_requests, repository_hooks (webhooks), repository_projects, secret_scanning_alerts, secrets (Actions secrets), security_events (code scanning/Dependabot), single_file, statuses (commit statuses), vulnerability_alerts (Dependabot), workflows (workflow files), members (collaborators). Values can be 'read' or 'write'."
    ),
});
