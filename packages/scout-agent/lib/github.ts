import * as github from "@blink-sdk/github";
import { Octokit } from "@octokit/core";
import { type Tool, tool, type UIMessage } from "ai";
import * as blink from "blink";
import type { Logger } from "./types";

export const getGithubAppContext = async ({
  githubAppID,
  githubAppPrivateKey,
}: {
  githubAppID: string;
  githubAppPrivateKey: string;
}): Promise<{
  appId: string;
  privateKey: string;
}> => {
  return {
    appId: githubAppID,
    privateKey: Buffer.from(githubAppPrivateKey, "base64").toString("utf-8"),
  };
};

export const createGitHubTools = ({
  agent,
  chatID,
  githubAppID,
  githubAppPrivateKey,
}: {
  agent: blink.Agent<UIMessage>;
  chatID: blink.ID;
  githubAppID: string;
  githubAppPrivateKey: string;
}): Record<string, Tool> => {
  return {
    ...blink.tools.prefix(
      blink.tools.withContext(github.tools, {
        appAuth: async () => {
          // TODO: This is janky.
          const context = await getGithubAppContext({
            githubAppID,
            githubAppPrivateKey,
          });
          return context;
        },
      }),
      "github_"
    ),

    github_create_pull_request: tool({
      description: github.tools.create_pull_request.description,
      inputSchema: github.tools.create_pull_request.inputSchema,
      execute: async (args, { abortSignal }) => {
        const githubAppContext = await getGithubAppContext({
          githubAppID,
          githubAppPrivateKey,
        });
        if (!githubAppContext) {
          throw new Error(
            "You are not authorized to use this tool in this context."
          );
        }
        const token = await github.authenticateApp(githubAppContext);
        const octokit = new Octokit({
          auth: token,
        });

        const response = await octokit.request(
          "POST /repos/{owner}/{repo}/pulls",
          {
            owner: args.owner,
            repo: args.repo,
            base: args.base,
            head: args.head,
            title: args.title,
            body: args.body ?? "",
            draft: args.draft,
            request: {
              signal: abortSignal,
            },
          }
        );

        await agent.store.set(`chat-id-for-pr-${response.data.id}`, chatID);
        await agent.store.set(
          `chat-id-for-pr-${response.data.node_id}`,
          chatID
        );

        return {
          pull_request: {
            number: response.data.number,
            comments: response.data.comments,
            title: response.data.title ?? "",
            body: response.data.body ?? "",
            state: response.data.state as "open" | "closed",
            created_at: response.data.created_at,
            updated_at: response.data.updated_at,
            user: {
              login: response.data.user?.login ?? "",
            },
            head: {
              ref: response.data.head.ref,
              sha: response.data.head.sha,
            },
            base: {
              ref: response.data.base.ref,
              sha: response.data.base.sha,
            },
            merged_at: response.data.merged_at ?? undefined,
            merge_commit_sha: response.data.merge_commit_sha ?? undefined,
            merged_by: response.data.merged_by
              ? {
                  login: response.data.merged_by.login,
                  avatar_url: response.data.merged_by.avatar_url ?? "",
                  html_url: response.data.merged_by.html_url ?? "",
                }
              : undefined,
            review_comments: response.data.review_comments,
            additions: response.data.additions,
            deletions: response.data.deletions,
            changed_files: response.data.changed_files,
          },
        };
      },
    }),
  };
};

export const handleGitHubWebhook = async ({
  request,
  agent,
  githubWebhookSecret,
  logger,
}: {
  request: Request;
  agent: blink.Agent<UIMessage>;
  githubWebhookSecret: string;
  logger: Logger;
}): Promise<Response> => {
  const { Webhooks } = await import("@octokit/webhooks");
  const webhooks = new Webhooks({
    secret: githubWebhookSecret,
  });
  const [id, event, signature] = [
    request.headers.get("x-github-delivery"),
    request.headers.get("x-github-event"),
    request.headers.get("x-hub-signature-256"),
  ];
  if (!signature || !id || !event) {
    return new Response("Unauthorized", { status: 401 });
  }

  const queueIfAssociatedWithChat = async (props: {
    prID?: number;
    prNodeID?: string;
    userMessage: string;
    modelMessage: string;
  }) => {
    const chat = await agent.store.get(
      `chat-id-for-pr-${props.prNodeID ?? props.prID}`
    );
    if (chat) {
      await agent.chat.sendMessages(chat as blink.ID, [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: props.userMessage,
            },
            {
              type: "text",
              text: props.modelMessage,
            },
          ],
        },
      ]);
    }
  };

  webhooks.on("pull_request", async (event) => {
    if (event.payload.pull_request.merged) {
      await queueIfAssociatedWithChat({
        prID: event.payload.pull_request.id,
        userMessage: `The pull request was merged.`,
        modelMessage: `A webhook was received for a pull request merge.
  
  Pull request ID: ${event.payload.pull_request.id}
  Pull request state: ${event.payload.pull_request.state}
  Pull request merged: ${event.payload.pull_request.merged}
  Pull request merged at: ${event.payload.pull_request.merged_at}
  `,
      });
    }
  });

  webhooks.on("pull_request_review", async (event) => {
    if (event.payload.sender.login === process.env.GITHUB_BOT_LOGIN) {
      return;
    }
    await queueIfAssociatedWithChat({
      prID: event.payload.pull_request.id,
      userMessage: `A pull request was reviewed by ${event.payload.review.state} by ${event.payload.sender.login}.`,
      modelMessage: `A webhook was received for a pull request review.
  
  Review ID: ${event.payload.review.id}
  Review state: ${event.payload.review.state}
  Reviewer: ${event.payload.sender.login}
  Review commit: ${event.payload.review.commit_id}
  
  Review body:
  ${event.payload.review.body ?? "No body provided."}
  
  ---
  
  There may be comments on the review you should read. If the review requests changes, you are responsible for making the changes.
  `,
    });
  });

  webhooks.on("pull_request_review_comment", async (event) => {
    if (event.payload.sender.login === process.env.GITHUB_BOT_LOGIN) {
      return;
    }

    const association = event.payload.comment.author_association;
    if (
      association !== "COLLABORATOR" &&
      association !== "MEMBER" &&
      association !== "OWNER"
    ) {
      return;
    }

    await queueIfAssociatedWithChat({
      prID: event.payload.pull_request.id,
      userMessage: `A pull request comment was ${event.payload.action} by ${event.payload.sender.login}.`,
      modelMessage: `A webhook was received for a pull request comment.
  
  Comment ID: ${event.payload.comment.id}
  Commenter: ${event.payload.sender.login}
  Comment commit: ${event.payload.comment.commit_id}
  
  Comment body:
  ${event.payload.comment.body}
  
  ---
  
  If the comment requests changes, you are responsible for making the changes.
  `,
    });
  });

  webhooks.on("issue_comment", async (event) => {
    if (event.payload.sender.login === process.env.GITHUB_BOT_LOGIN) {
      return;
    }

    const association = event.payload.comment.author_association;
    if (
      association !== "COLLABORATOR" &&
      association !== "MEMBER" &&
      association !== "OWNER"
    ) {
      return;
    }

    await queueIfAssociatedWithChat({
      // The "id" is not consistent between issue_comment and pull_request webhooks.
      // The "node_id" is.
      // Try getting `/repos/coder/coder/issues/<pr>` and `/repos/coder/coder/pulls/<pr>`,
      // the `id` property will be different.
      prNodeID: event.payload.issue.node_id,
      userMessage: `An issue comment was ${event.payload.action} by ${event.payload.sender.login}.`,
      modelMessage: `A webhook was received for an issue comment.
  
  Comment ID: ${event.payload.comment.id}
  Commenter: ${event.payload.sender.login}
  
  Comment body:
  ${event.payload.comment.body}
  
  ---
  
  If the comment requests changes, you are responsible for making the changes.
  `,
    });
  });

  // This is when a thread is resolved. I don't think we need to do anything here.
  webhooks.on("pull_request_review_thread", async (_event) => {
    //
  });

  webhooks.on("check_run.completed", async (event) => {
    if (
      event.payload.check_run.conclusion === "success" ||
      event.payload.check_run.conclusion === "skipped"
    ) {
      // Just ignore - we don't care about successful check runs.
      return;
    }
    for (const pr of event.payload.check_run.pull_requests) {
      // This is an old check run.
      if (event.payload.check_run.head_sha !== pr.head.sha) {
        continue;
      }

      await queueIfAssociatedWithChat({
        prID: pr.id,
        userMessage: `A check run was completed for a pull request.`,
        modelMessage: `A webhook was received for a check run.
  
  Check run ID: ${event.payload.check_run.id}
  Check run status: ${event.payload.check_run.status}
  Check run conclusion: ${event.payload.check_run.conclusion}
  
  ---
  
  If the check run fails, you are responsible for fixing the issue.
  `,
      });
    }
  });

  // These are GitHub webhook requests.
  return webhooks
    .verifyAndReceive({
      id,
      name: event,
      payload: await request.text(),
      signature,
    })
    .then(() => {
      return new Response("OK", { status: 200 });
    })
    .catch((err) => {
      logger.error("GitHub webhook error", err);
      return new Response("Error", { status: 500 });
    });
};
