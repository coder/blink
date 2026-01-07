import { createAppAuth, type InstallationAuthOptions } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import type { Endpoints } from "@octokit/types";
import { tool, type Tool } from "ai";
import type { ToolWithContext } from "blink";
import { parsePatch } from "diff";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";

const globalOctokit: Octokit = new Octokit();

type AsyncOrSync<T> = T | Promise<T> | (() => Promise<T>) | (() => T);

const asyncOrSync = async <T>(value: AsyncOrSync<T>): Promise<T> => {
  if (typeof value === "function") {
    // @ts-expect-error - We know this is a function.
    return value();
  }
  return value;
};

export type AppAuthOptions = {
  appId: string;
  privateKey: string;
  /**
   * installationId must be provided if the app is installed on more
   * than one organization.
   */
  installationId?: number;
  cache?: {
    set: (key: string, value: string) => Promise<void>;
    get: (key: string) => Promise<string | undefined>;
  };
  permissions?: Record<string, string>;
} & (
  | {
      repositoryNames?: string[];
    }
  | {
      repositoryIds?: number[];
    }
);

/**
 * Authenticate a GitHub app.
 * @param appAuth - The app authentication options.
 * @returns The access token for the app.
 */
export async function authenticateApp(
  appAuth: AppAuthOptions
): Promise<string> {
  type CachedToken = {
    token: string;
    expiresAt: string;
  };

  let installationId = appAuth.installationId;
  if (!installationId) {
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        type: "app",
        appId: appAuth.appId,
        privateKey: appAuth.privateKey,
      },
    });
    // If no installation ID is provided, we need to find it.
    const installations = await octokit.request("GET /app/installations", {
      per_page: 2,
    });
    if (installations.data.length > 1) {
      throw new Error(
        "Multiple installations found for app. Please provide an installation ID."
      );
    }
    if (installations.data.length === 0) {
      throw new Error("No installations found for app. You must install it!");
    }
    const installation = installations.data[0]!;
    installationId = installation.id;
  }

  // Check if a cached token exists...
  const cachedTokenKey = (() => {
    const parts = ["github-app-auth", appAuth.appId, installationId.toString()];
    if ("repositoryNames" in appAuth) {
      parts.push(...(appAuth.repositoryNames ?? []));
    } else if ("repositoryIds" in appAuth) {
      parts.push(...(appAuth.repositoryIds?.map((id) => id.toString()) ?? []));
    }
    return parts.join("-");
  })();

  const cachedToken = await appAuth.cache?.get(cachedTokenKey);
  if (cachedToken) {
    const parsed = JSON.parse(cachedToken) as CachedToken;
    if (new Date(parsed.expiresAt) > new Date()) {
      return parsed.token;
    }
  }

  const auth = createAppAuth({
    appId: appAuth.appId,
    privateKey: appAuth.privateKey,
  });

  const options: InstallationAuthOptions = {
    type: "installation",
    installationId,
  };
  if ("repositoryNames" in appAuth) {
    options.repositoryNames = appAuth.repositoryNames;
  } else if ("repositoryIds" in appAuth) {
    options.repositoryIds = appAuth.repositoryIds;
  }
  if ("permissions" in appAuth) {
    options.permissions = appAuth.permissions;
  }
  const installationToken = await auth(options);

  const newToken: CachedToken = {
    token: installationToken.token,
    expiresAt: installationToken.expiresAt,
  };
  await appAuth.cache?.set(cachedTokenKey, JSON.stringify(newToken));
  return installationToken.token;
}

export type GithubToolContext =
  | {
      /**
       * accessToken specifies an access token to use for authentication.
       */
      accessToken: AsyncOrSync<string>;
    }
  | {
      /**
       * appAuth specifies an app authentication to use for authentication.
       * Tokens will be cached and reused to avoid rate limiting.
       */
      appAuth: AsyncOrSync<AppAuthOptions>;
    }
  | {
      /**
       * Customize all behavior of requests with your own Octokit instance.
       */
      octokit: AsyncOrSync<Octokit>;
    };

const toolWithOctokit = (
  fn: (ctx: { octokit: () => Promise<Octokit> }) => Tool
): ToolWithContext<GithubToolContext, Tool> => {
  return {
    ...fn({ octokit: () => Promise.resolve(globalOctokit) }),
    withContext: (ctx: GithubToolContext) => {
      if ("accessToken" in ctx) {
        return fn({
          octokit: async () => {
            const token = await asyncOrSync(ctx.accessToken);
            return new Octokit({
              auth: token,
            });
          },
        });
      } else if ("appAuth" in ctx) {
        return fn({
          octokit: async () => {
            const appAuth = await asyncOrSync(ctx.appAuth);
            const token = await authenticateApp(appAuth);
            return new Octokit({
              auth: token,
            });
          },
        });
      } else if ("octokit" in ctx) {
        return fn({
          octokit: async () => {
            return await asyncOrSync(ctx.octokit);
          },
        });
      }

      return fn({
        octokit: async () => {
          return globalOctokit;
        },
      });
    },
  };
};

const githubReactionSchema = z.enum([
  "+1",
  "-1",
  "laugh",
  "confused",
  "heart",
  "hooray",
  "rocket",
  "eyes",
]);

export const tools = {
  list_user_installations: toolWithOctokit(({ octokit }) =>
    tool({
      description: `List GitHub installations you have access to.`,
      inputSchema: z.object({
        page: z.number().optional(),
        per_page: z.number().optional(),
      }),
      execute: async (args, { abortSignal }) => {
        const response = await (
          await octokit()
        ).request("GET /user/installations", {
          page: args.page,
          per_page: args.per_page,
          request: {
            signal: abortSignal,
          },
        });
        return response.data;
      },
    })
  ),

  list_app_installations: toolWithOctokit(({ octokit }) =>
    tool({
      description: `List GitHub installations you have access to.`,
      inputSchema: z.object({
        page: z.number().optional(),
        per_page: z.number().optional(),
      }),
      execute: async (args, { abortSignal }) => {
        const response = await (
          await octokit()
        ).request("GET /app/installations", {
          page: args.page,
          per_page: args.per_page,
        });
        return response.data;
      },
    })
  ),

  get_organization: toolWithOctokit(({ octokit }) =>
    tool({
      description: "Get information about a GitHub organization.",
      inputSchema: z.object({
        organization: z.string(),
      }),
      execute: async ({ organization }, { abortSignal }) => {
        const response = await (
          await octokit()
        ).request("GET /orgs/{org}", {
          org: organization,
          request: {
            signal: abortSignal,
          },
        });
        return {
          name: response.data.name ?? "",
          description: response.data.description ?? "",
          avatar_url: response.data.avatar_url ?? "",
          url: response.data.url ?? "",
          html_url: response.data.html_url ?? "",
        };
      },
    })
  ),

  search_repositories: toolWithOctokit(({ octokit }) =>
    tool({
      description:
        "Search for GitHub repositories. Use the GitHub Search Syntax (e.g. 'org:<org>' or 'repo:<org/repo>' or '<plain text>').",
      inputSchema: z.object({
        query: z.string(),
        page: z.number(),
        per_page: z.number(),
      }),
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /search/repositories", {
          q: args.query,
          page: args.page,
          per_page: args.per_page,
        });
        return {
          incomplete_results: response.data.incomplete_results,
          total_count: response.data.total_count,
          items: response.data.items.map((repo) => ({
            name: repo.name,
            stargazers_count: repo.stargazers_count ?? 0,
            watchers_count: repo.watchers_count ?? 0,
            language: repo.language ?? "",
            // Some GitHub descriptions are super long...
            description: repo.description?.slice(0, 255) ?? "",
            fork: repo.fork,
            homepage: repo.homepage ?? "",
            open_issues_count: repo.open_issues_count ?? 0,
            topics: repo.topics ?? [],
            default_branch: repo.default_branch ?? "",
            visibility: (repo.visibility as "public" | "private") ?? "public",
            license: {
              name: repo.license?.name ?? "",
            },
          })),
        };
      },
    })
  ),

  get_repository: toolWithOctokit(({ octokit }) =>
    tool({
      description: `Get a repository.`,
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
      }),
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}", {
          owner: args.owner,
          repo: args.repo,
          request: {
            signal: opts.abortSignal,
          },
        });

        return {
          name: response.data.name,
          stargazers_count: response.data.stargazers_count,
          watchers_count: response.data.watchers_count,
          language: response.data.language ?? "",
          description: response.data.description?.slice(0, 255) ?? "",
          fork: response.data.fork,
          homepage: response.data.homepage ?? "",
          open_issues_count: response.data.open_issues_count,
          topics: response.data.topics ?? [],
          default_branch: response.data.default_branch,
          visibility:
            (response.data.visibility as "public" | "private") ?? "public",
          license: {
            name: response.data.license?.name ?? "",
          },
        };
      },
    })
  ),

  search_issues: toolWithOctokit(({ octokit }) =>
    tool({
      description:
        "Search for issues or pull requests. Use the GitHub Search Syntax (e.g. 'org:<org>', 'repo:<org/repo>', '<plain text>', 'is:issue', 'is:pr').",
      inputSchema: z.object({
        query: z.string(),
        page: z.number(),
        per_page: z.number(),
        sort: z.enum([
          "comments",
          "reactions",
          "reactions-+1",
          "reactions--1",
          "reactions-smile",
          "reactions-thinking_face",
          "reactions-heart",
          "reactions-tada",
          "interactions",
          "created",
          "updated",
        ]),
        include_body: z.boolean(),
      }),
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /search/issues", {
          q: args.query,
          page: args.page,
          sort: args.sort,
          per_page: args.per_page,
          advanced_search: "true",
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          total_count: response.data.total_count,
          incomplete_results: response.data.incomplete_results,
          items: response.data.items.map((issue) => ({
            number: issue.number,
            comments: issue.comments,
            url: issue.html_url,
            title: issue.title,
            state: issue.state as "open" | "closed",
            locked: issue.locked,
            citation_id: crypto.randomUUID(),
            user: {
              login: issue.user?.login ?? "",
            },
            assignees:
              issue.assignees?.map((a) => ({
                name: a.login,
                avatar_url: a.avatar_url ?? "",
                url: a.url ?? "",
                html_url: a.html_url ?? "",
              })) ?? [],
            labels:
              issue.labels.map((l) => ({
                name: l.name as string,
                description: l.description ?? "",
              })) ?? [],
            body: args.include_body ? issue.body : undefined,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            closed_at: issue.closed_at ?? undefined,
            pull_request: issue.pull_request
              ? {
                  merged_at: issue.pull_request.merged_at ?? undefined,
                }
              : undefined,
          })),
        };
      },
    })
  ),

  get_pull_request: toolWithOctokit(({ octokit }) =>
    tool({
      description: "Get a pull request.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        pull_number: z.number(),
      }),
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
          owner: args.owner,
          repo: args.repo,
          pull_number: args.pull_number,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          number: response.data.number,
          state: response.data.state as "open" | "closed",
          title: response.data.title ?? "",
          body: response.data.body ?? "",
          created_at: response.data.created_at,
          updated_at: response.data.updated_at,
          closed_at: response.data.closed_at ?? undefined,
          merged_at: response.data.merged_at ?? undefined,
          merge_commit_sha: response.data.merge_commit_sha ?? undefined,
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
          comments: response.data.comments,
          review_comments: response.data.review_comments,
          additions: response.data.additions,
          deletions: response.data.deletions,
          changed_files: response.data.changed_files,
          merged_by: response.data.merged_by
            ? {
                login: response.data.merged_by.login,
                avatar_url: response.data.merged_by.avatar_url ?? "",
                html_url: response.data.merged_by.html_url ?? "",
              }
            : undefined,
        };
      },
    })
  ),

  get_issue: toolWithOctokit(({ octokit }) =>
    tool({
      description: "Get an issue.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        issue_number: z.number(),
      }),
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
          owner: args.owner,
          repo: args.repo,
          issue_number: args.issue_number,
          mediaType: {
            format: "html",
          },
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          number: response.data.number,
          url: response.data.html_url,
          state: response.data.state as "open" | "closed",
          title: response.data.title ?? "",
          body_html: response.data.body_html ?? "",
          citation_id: crypto.randomUUID(),
          assignees:
            response.data.assignees?.map((a) => ({
              name: a.login,
              avatar_url: a.avatar_url ?? "",
              url: a.url ?? "",
              html_url: a.html_url ?? "",
            })) ?? [],
          labels:
            response.data.labels.map((l) => {
              if (typeof l === "string") {
                return {
                  name: l,
                  description: "",
                };
              }
              return {
                name: l.name as string,
                description: l.description ?? "",
              };
            }) ?? [],
          locked: response.data.locked,
          user: {
            login: response.data.user?.login ?? "",
          },
          comments: response.data.comments,
          created_at: response.data.created_at,
          updated_at: response.data.updated_at,
          closed_at: response.data.closed_at ?? undefined,
          pull_request: response.data.pull_request
            ? {
                merged_at: response.data.pull_request.merged_at ?? undefined,
              }
            : undefined,
        };
      },
    })
  ),

  list_issue_comments: toolWithOctokit(({ octokit }) =>
    tool({
      description: "List comments on an issue or pull request.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        issue_number: z.number(),
      }),
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
          owner: args.owner,
          repo: args.repo,
          issue_number: args.issue_number,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          comments: response.data.map((comment) => ({
            id: comment.id,
            body: comment.body ?? "",
            created_at: comment.created_at,
            updated_at: comment.updated_at,
            author_association: comment.author_association as
              | "COLLABORATOR"
              | "CONTRIBUTOR"
              | "FIRST_TIMER"
              | "FIRST_TIME_CONTRIBUTOR"
              | "MEMBER"
              | "NONE"
              | "OWNER",
            user: {
              login: comment.user?.login ?? "",
            },
          })),
        };
      },
    })
  ),

  list_repository_contributors: toolWithOctokit(({ octokit }) =>
    tool({
      description: "List contributors to a repository.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
      }),
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/contributors", {
          owner: args.owner,
          repo: args.repo,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          contributors: response.data.map((contributor) => ({
            login: contributor.login ?? "",
            contributions: contributor.contributions,
            type: contributor.type as "User" | "Bot",
          })),
        };
      },
    })
  ),

  list_pull_request_files: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        pull_number: z.number(),
        page: z.number(),
        per_page: z.number(),
      }),
      description:
        "List files changed in a pull request. Use this with 'github_repository_read_file' to read the contents of the files.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
          owner: args.owner,
          repo: args.repo,
          pull_number: args.pull_number,
          page: args.page,
          per_page: args.per_page,
          request: {
            signal: opts.abortSignal,
          },
        });

        return {
          files: response.data.map((file) => {
            const patches = parsePatch(file.patch as string);
            if (patches.length > 1) {
              throw new Error("Multiple patches found for a single file!");
            }
            const patch = patches[0]!;

            return {
              filename: file.filename,
              status: file.status,
              structured_patch: patch.hunks.map((hunk) => {
                return {
                  old_start: hunk.oldStart,
                  old_end: hunk.oldLines,
                  new_start: hunk.newStart,
                  new_end: hunk.newLines,
                };
              }),
              sha: file.sha,
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
              contents_url: file.contents_url,
              blob_url: file.blob_url,
            };
          }),
        };
      },
    })
  ),

  repository_read_file: toolWithOctokit(({ octokit }) =>
    tool({
      description:
        "Read a file from a repository. This does not use GitHub API calls. Absolute paths must be used. The root is at /. Read 250 lines at a time.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        ref: z.string(),
        file_path: z.string(),
        line_offset: z.number(),
        line_limit: z.number(),
      }),
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner: args.owner,
          repo: args.repo,
          path: args.file_path,
          ref: args.ref,
          mediaType: {
            format: "raw",
          },
          request: {
            signal: opts.abortSignal,
          },
        });
        // By default, GitHub returns the raw string in utf8 bytes.
        const content = response.data as unknown as string;
        const buffer = Buffer.from(content, "utf8");
        const fileType = await fileTypeFromBuffer(buffer);
        const isText = !fileType?.mime || fileType.mime === "text/plain";

        if (!isText) {
          return {
            content: Buffer.from(buffer).toString("base64"),
            mime_type: fileType?.mime,
            total_lines: 0,
            lines_read: 0,
            start_line: 0,
          };
        }

        const lines = content.split("\n");
        return {
          citation_id: crypto.randomUUID(),
          total_lines: lines.length,
          lines_read: lines.length,
          start_line: args.line_offset,
          content: lines
            .slice(args.line_offset, args.line_offset + args.line_limit)
            .join("\n"),
          // This is just casting it as a const.
          mime_type: fileType?.mime as "text/plain",
        };
      },
      toModelOutput(result) {
        if (result.mime_type?.startsWith("image/")) {
          return {
            type: "content",
            value: [
              {
                type: "media",
                data: result.content,
                mediaType: result.mime_type,
              },
            ],
          };
        }
        return {
          type: "json",
          value: result,
        };
      },
    })
  ),

  repository_grep_file: toolWithOctokit(({ octokit }) =>
    tool({
      description: "Grep a file in a repository.",
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        ref: z.string(),
        file_path: z.string(),
        pattern: z.string(),
        before_lines: z.number(),
        after_lines: z.number(),
      }),
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner: args.owner,
          repo: args.repo,
          path: args.file_path,
          ref: args.ref,
          mediaType: {
            format: "raw",
          },
          request: {
            signal: opts.abortSignal,
          },
        });
        if (Array.isArray(response.data)) {
          throw new Error("This path is a directory, not a file.");
        }

        // By default, GitHub returns the raw string in utf8 bytes.
        const content = response.data as unknown as string;

        let regex: RegExp;
        try {
          regex = new RegExp(args.pattern);
        } catch (err) {
          throw new Error(`Invalid regex pattern: ${args.pattern}`);
        }

        const matches: {
          line_number: number;
          lines: string[];
        }[] = [];
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const match = line.match(regex);
          if (match) {
            // Calculate the range of lines to include
            const startLine = Math.max(0, i - args.before_lines);
            const endLine = Math.min(lines.length - 1, i + args.after_lines);

            // Extract the lines including context
            const contextLines = lines.slice(startLine, endLine + 1);

            matches.push({
              line_number: i,
              lines: contextLines,
            });
          }
        }

        if (matches.length > 256) {
          throw new Error("Too many matches. Please refine your search.");
        }

        return {
          citation_id: crypto.randomUUID(),
          matches,
          total_matches: matches.length,
        };
      },
    })
  ),

  repository_list_directory: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        ref: z.string(),
        path: z.string(),
      }),
      description:
        "List a directory in a repository. This does not use GitHub API calls. Absolute paths must be used. The root is at /.",
      execute: async (args, opts) => {
        if (args.path === "/" || args.path === ".") {
          args.path = "";
        }
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/contents/{path}", {
          owner: args.owner,
          repo: args.repo,
          path: args.path,
          ref: args.ref,
          mediaType: {
            format: "raw",
          },
          request: {
            signal: opts.abortSignal,
          },
        });

        if (!Array.isArray(response.data)) {
          throw new Error("This path is a file, not a directory.");
        }
        return {
          files: response.data.map((file) => {
            return {
              type: file.type,
              path: file.path,
              size: file.type === "file" ? file.size : undefined,
            };
          }),
        };
      },
    })
  ),

  search_code: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        query: z.string(),
        page: z.number(),
        per_page: z.number(),
      }),

      description:
        "Search for code in a repository. Use the GitHub Search Syntax (e.g. 'org:<org>', 'repo:<org/repo>', '<plain text>', 'is:issue', 'is:pr'). This endpoint is highly rate-limited, so use it sparingly.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /search/code", {
          q: args.query,
          page: args.page,
          per_page: args.per_page,
          mediaType: {
            format: "text-match",
          },
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          total_count: response.data.total_count,
          incomplete_results: response.data.incomplete_results,
          items: response.data.items.map((item) => ({
            path: "/" + item.path,
            repository: {
              owner: item.repository.owner.login,
              name: item.repository.name,
            },
            text_matches:
              item.text_matches?.map((match) => {
                return {
                  fragment: match.fragment as string,
                  citation_id: crypto.randomUUID(),
                  matches:
                    match.matches?.map((m) => {
                      return {
                        text: m.text as string,
                        indices: m.indices as number[],
                      };
                    }) || [],
                };
              }) || [],
          })),
        };
      },
    })
  ),

  list_releases: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        page: z.number(),
        per_page: z.number(),
        include_body_and_assets: z.boolean(),
      }),
      description: "List releases for a repository.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/releases", {
          owner: args.owner,
          repo: args.repo,
          page: args.page,
          per_page: args.per_page,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          releases: response.data.map((release) => ({
            id: release.id,
            name: release.name ?? undefined,
            tag_name: release.tag_name,
            body: args.include_body_and_assets
              ? (release.body ?? undefined)
              : undefined,
            draft: release.draft,
            prerelease: release.prerelease,
            created_at: release.created_at,
            published_at: release.published_at ?? undefined,
            target_commitish: release.target_commitish,
            citation_id: crypto.randomUUID(),
            assets: args.include_body_and_assets
              ? release.assets.map((asset) => ({
                  id: asset.id,
                  name: asset.name,
                  browser_download_url: asset.browser_download_url,
                  download_count: asset.download_count,
                  content_type: asset.content_type,
                  size: asset.size,
                }))
              : undefined,
          })),
        };
      },
    })
  ),

  get_commit: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        commit_sha: z.string(),
      }),
      description: "Get a commit by its SHA.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/commits/{commit_sha}", {
          owner: args.owner,
          repo: args.repo,
          commit_sha: args.commit_sha,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          message: response.data.commit.message,
          html_url: response.data.html_url,
          citation_id: crypto.randomUUID(),
          sha: response.data.sha,
          commit_author: {
            name: response.data.commit.author?.name ?? "",
            date: response.data.commit.author?.date ?? "",
            email: response.data.commit.author?.email ?? "",
          },
          parents: response.data.parents.map((p: any) => ({
            sha: p.sha,
            html_url: p.html_url,
          })),
        };
      },
    })
  ),

  get_pull_request_diff: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        pull_number: z.number(),
        line_offset: z.number(),
        line_limit: z.number(),
      }),
      description: `Get the diff for a pull request.

    Usage:
    - A 250 line limit is enforced. If over 250 lines are requested, only 250 lines will be returned.
    - Use the line_offset and line_limit parameters to read a specific range of lines.`,
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
          owner: args.owner,
          repo: args.repo,
          pull_number: args.pull_number,
          mediaType: {
            format: "diff",
          },
          request: {
            signal: opts.abortSignal,
          },
        });
        // @ts-expect-error - When media type diff is used, the response is a string.
        const diff = response.data as string;
        const lines = diff.split("\n");
        const startLine = args.line_offset;
        const endLine = startLine + args.line_limit;
        const content = lines.slice(startLine, endLine).join("\n");
        return {
          content,
          total_lines: lines.length,
          lines_read: endLine - startLine,
          start_line: startLine,
        };
      },
    })
  ),

  get_commit_diff: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        commit_sha: z.string(),
        line_offset: z.number(),
        line_limit: z.number(),
      }),
      description: `Get the diff for a commit.

    Usage:
    - A 250 line limit is enforced. If over 250 lines are requested, only 250 lines will be returned.
    - Use the line_offset and line_limit parameters to read a specific range of lines.`,
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/commits/{commit_sha}", {
          owner: args.owner,
          repo: args.repo,
          commit_sha: args.commit_sha,
          mediaType: {
            format: "diff",
          },
          request: {
            signal: opts.abortSignal,
          },
        });
        const diff = response.data as string;
        const lines = diff.split("\n");
        const startLine = args.line_offset;
        const endLine = startLine + args.line_limit;
        const content = lines.slice(startLine, endLine).join("\n");
        return {
          total_lines: lines.length,
          lines_read: endLine - startLine,
          start_line: startLine,
          content,
        };
      },
    })
  ),

  list_commits: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        page: z.number(),
        per_page: z.number(),
        sha: z
          .string()
          .describe(
            "The SHA or branch to list commits from. Leave blank to use the repository's default branch."
          ),
        path: z
          .string()
          .describe(
            "A file path to filter commits by. Leave blank to include all paths."
          ),
        author: z
          .string()
          .describe(
            "GitHub username or email to filter by. Leave blank to include all authors."
          ),
        since: z
          .string()
          .describe(
            "ISO 8601 date to include commits after this date. Leave blank to not filter by date."
          ),
        until: z
          .string()
          .describe(
            "ISO 8601 date to include commits before this date. Leave blank to not filter by date."
          ),
      }),
      description: "List commits for a repository.",
      execute: async (args, opts) => {
        1;
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/commits", {
          owner: args.owner,
          repo: args.repo,
          per_page: args.per_page,
          page: args.page,
          sha: args.sha.length > 0 ? args.sha : undefined,
          path: args.path.length > 0 ? args.path : undefined,
          author: args.author.length > 0 ? args.author : undefined,
          since: args.since.length > 0 ? args.since : undefined,
          until: args.until.length > 0 ? args.until : undefined,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          commits: response.data.map((c) => ({
            sha: c.sha,
            html_url:
              (c.html_url as string) ||
              `https://github.com/${args.owner}/${args.repo}/commit/${c.sha}`,
            message: c.commit?.message ?? "",
            commit_author: {
              name: c.commit?.author?.name ?? "",
              email: c.commit?.author?.email ?? "",
              date: c.commit?.author?.date ?? "",
            },
            parents: (c.parents ?? []).map((p) => ({
              sha: p.sha as string,
              html_url:
                (p.html_url as string) ||
                `https://github.com/${args.owner}/${args.repo}/commit/${p.sha}`,
            })),
            citation_id: crypto.randomUUID(),
          })),
        };
      },
    })
  ),

  get_user: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        username: z.string().optional(),
      }),
      description:
        "Get a user by their username. Leave the username blank to get the currently authenticated user.",
      execute: async (args, { abortSignal }) => {
        let response:
          | Endpoints["GET /users/{username}"]["response"]["data"]
          | Endpoints["GET /user"]["response"]["data"];
        if (args.username) {
          response = (
            await (
              await octokit()
            ).request("GET /users/{username}", {
              username: args.username,
              request: {
                signal: abortSignal,
              },
            })
          ).data;
        } else {
          response = (
            await (
              await octokit()
            ).request("GET /user", {
              request: {
                signal: abortSignal,
              },
            })
          ).data;
        }

        return {
          login: response.login,
          name: response.name ?? "",
          url: response.url,
          id: response.id,
          avatar_url: response.avatar_url,
          html_url: response.html_url,
          followers_url: response.followers_url ?? undefined,
          following_url: response.following_url ?? undefined,
          gists_url: response.gists_url ?? undefined,
        };
      },
    })
  ),

  create_pull_request: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        base: z.string(),
        head: z.string(),
        title: z.string(),
        body: z.string().optional(),
        draft: z.boolean().optional(),
      }),

      description: `Create a pull request on GitHub.`,
      execute: async (args, { abortSignal }) => {
        const response = await (
          await octokit()
        ).request("POST /repos/{owner}/{repo}/pulls", {
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
        });

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
    })
  ),

  actions_list_runs: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        head_sha: z.string(),
      }),
      description: "List runs for a repository.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/actions/runs", {
          owner: args.owner,
          repo: args.repo,
          head_sha: args.head_sha,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          total_count: response.data.total_count,
          workflow_runs: response.data.workflow_runs.map((run) => ({
            id: run.id,
            name: run.name ?? "",
            status: run.status as "pending" | "in_progress" | "completed",
            conclusion: run.conclusion as
              | "success"
              | "failure"
              | "neutral"
              | "cancelled"
              | "timed_out"
              | "action_required"
              | "skipped"
              | "stale",
            created_at: run.created_at,
            updated_at: run.updated_at,
            path: run.path,
            display_title: run.display_title,
          })),
        };
      },
    })
  ),

  actions_list_jobs: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        run_id: z.number(),
      }),
      description: "List jobs for a run.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs", {
          owner: args.owner,
          repo: args.repo,
          run_id: args.run_id,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          total_count: response.data.total_count,
          jobs: response.data.jobs.map((job) => ({
            id: job.id,
            workflow_name: job.workflow_name as string,
            completed_at: job.completed_at as string,
            created_at: job.created_at as string,
            name: job.name,
            labels: job.labels,
            head_branch: job.head_branch as string,
            run_attempt: job.run_attempt as number,
            runner_name: job.runner_name as string,
            runner_group_name: job.runner_group_name as string,
            conclusion: job.conclusion as
              | "success"
              | "failure"
              | "neutral"
              | "cancelled"
              | "timed_out"
              | "action_required"
              | "skipped"
              | "stale",
            started_at: job.started_at as string,
            status: job.status as "pending" | "in_progress" | "completed",
            steps:
              job.steps?.map((step) => ({
                name: step.name,
                status: step.status as "pending" | "in_progress" | "completed",
                conclusion: step.conclusion as
                  | "success"
                  | "failure"
                  | "neutral"
                  | "cancelled"
                  | "timed_out"
                  | "action_required"
                  | "skipped"
                  | "stale",
                started_at: step.started_at as string,
                completed_at: step.completed_at as string,
              })) || [],
          })),
        };
      },
    })
  ),

  actions_get_job_logs: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        job_id: z.number(),
        line_offset: z.number(),
        line_limit: z.number(),
      }),

      description: `Get the logs for a job.

Usage:
- A 250 line limit is enforced. If over 250 lines are requested, only 250 lines will be returned.
- Use the line_offset and line_limit parameters to read a specific range of lines.`,
      execute: async (args, opts) => {
        let logs: string;
        try {
          const response = await (
            await octokit()
          ).request("GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs", {
            owner: args.owner,
            repo: args.repo,
            job_id: args.job_id,
            request: {
              signal: opts.abortSignal,
            },
          });
          logs = response.data as string;
          if (typeof logs !== "string") {
            throw new Error("Logs are not a string: " + typeof logs);
          }
        } catch (err: any) {
          // For some weird reason, this fetch fails in Cloudflare Workers.
          // But it provides a 403 response with a URL redirect to the logs,
          // on a JWT-signed URL that we can fetch.
          if (err?.response?.url) {
            const response = await fetch(err.response.url);
            logs = await response.text();
          } else {
            throw err;
          }
        }

        const totalLines = logs.split("\n");
        let lines = totalLines.slice(
          args.line_offset,
          args.line_offset + args.line_limit
        );
        if (lines.length > 250) {
          lines = lines.slice(0, 250);
        }
        return {
          total_lines: totalLines.length,
          lines_read: lines.length,
          start_line: args.line_offset,
          content: lines.join("\n"),
        };
      },
    })
  ),

  update_issue: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        issue_number: z.number(),
        title: z.string(),
        body: z.string(),
        state: z.enum(["open", "closed"]),
        labels: z.array(z.string()),
        assignees: z.array(z.string()),
      }),
      description: "Update an issue.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
          owner: args.owner,
          repo: args.repo,
          issue_number: args.issue_number,
          title: args.title,
          body: args.body,
          state: args.state,
          labels: args.labels,
          assignees: args.assignees,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          issue: {
            number: response.data.number,
            url: response.data.html_url,
            state: response.data.state as "open" | "closed",
            title: response.data.title ?? "",
            body: response.data.body ?? "",
            assignees:
              response.data.assignees?.map((assignee) => ({
                name: assignee.login,
                avatar_url: assignee.avatar_url ?? "",
                url: assignee.url ?? "",
                html_url: assignee.html_url ?? "",
              })) ?? [],
            labels:
              response.data.labels?.map((label) => ({
                name: typeof label === "string" ? label : (label.name ?? ""),
                description:
                  typeof label === "string" ? "" : (label.description ?? ""),
              })) ?? [],
            locked: response.data.locked,
            comments: response.data.comments,
            created_at: response.data.created_at,
            updated_at: response.data.updated_at,
            citation_id: crypto.randomUUID(),
            user: {
              login: response.data.user?.login ?? "",
            },
          },
        };
      },
    })
  ),

  update_pull_request: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        pull_number: z.number(),

        title: z.string(),
        body: z.string(),
        state: z.enum(["open", "closed"]),
        base_branch: z
          .string()
          .describe(
            "The name of the branch you want your changes pulled into. Typically, this is the default branch."
          ),
      }),
      description: "Update a pull request.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
          owner: args.owner,
          repo: args.repo,
          pull_number: args.pull_number,
          title: args.title,
          body: args.body,
          state: args.state,
          base: args.base_branch,
          request: {
            signal: opts.abortSignal,
          },
        });
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
            additions: response.data.additions,
            deletions: response.data.deletions,
            changed_files: response.data.changed_files,
            review_comments: response.data.review_comments,
            closed_at: response.data.closed_at ?? undefined,
            merged_at: response.data.merged_at ?? undefined,
            merge_commit_sha: response.data.merge_commit_sha ?? undefined,
            merged_by: response.data.merged_by
              ? {
                  login: response.data.merged_by.login,
                  avatar_url: response.data.merged_by.avatar_url ?? "",
                  html_url: response.data.merged_by.html_url ?? "",
                }
              : undefined,
          },
        };
      },
    })
  ),

  create_issue: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        title: z.string(),
        body: z.string(),
        labels: z
          .array(z.string())
          .describe(
            "Only use labels if the user explicitly requested it, or you're confident a label exists."
          ),
        assignees: z
          .array(z.string())
          .describe(
            "Only set assignees if you're confident the user exists and should be assigned to the issue."
          ),
      }),
      description: `Create an issue. Do not use this tool unless explicitly instructed to do so.
        
    Avoid mentioning users with @ unless you are *certain* they are the user you intend to mention.
    
    All links must be publically accessible URLs.`,
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("POST /repos/{owner}/{repo}/issues", {
          owner: args.owner,
          repo: args.repo,
          title: args.title,
          body: args.body,
          labels: args.labels,
          assignees: args.assignees,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          issue: {
            number: response.data.number,
            url: response.data.html_url,
            state: response.data.state as "open" | "closed",
            title: response.data.title ?? "",
            body: response.data.body ?? "",
            assignees:
              response.data.assignees?.map((assignee) => ({
                name: assignee.login,
                avatar_url: assignee.avatar_url ?? "",
                url: assignee.url ?? "",
                html_url: assignee.html_url ?? "",
              })) ?? [],
            labels:
              response.data.labels?.map((label) => ({
                name: typeof label === "string" ? label : (label.name ?? ""),
                description:
                  typeof label === "string" ? "" : (label.description ?? ""),
              })) ?? [],
            locked: response.data.locked,
            comments: response.data.comments,
            created_at: response.data.created_at,
            updated_at: response.data.updated_at,
            citation_id: crypto.randomUUID(),
            user: {
              login: response.data.user?.login ?? "",
            },
            author_association: response.data.author_association as
              | "COLLABORATOR"
              | "CONTRIBUTOR"
              | "FIRST_TIMER"
              | "FIRST_TIME_CONTRIBUTOR"
              | "MEMBER"
              | "NONE"
              | "OWNER",
            pull_request: response.data.pull_request
              ? {
                  merged_at: response.data.pull_request.merged_at ?? undefined,
                }
              : undefined,
          },
        };
      },
    })
  ),

  create_issue_comment: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        issue_number: z.number(),
        body: z.string(),
      }),
      description:
        "Create a comment on an issue. Do not use this tool unless explicitly instructed to do so.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
          owner: args.owner,
          repo: args.repo,
          issue_number: args.issue_number,
          body: args.body,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          comment: {
            id: response.data.id,
            body: response.data.body ?? "",
            created_at: response.data.created_at,
            updated_at: response.data.updated_at,
            user: {
              login: response.data.user?.login ?? "",
            },
            author_association: response.data.author_association as
              | "COLLABORATOR"
              | "CONTRIBUTOR"
              | "FIRST_TIMER"
              | "FIRST_TIME_CONTRIBUTOR"
              | "MEMBER"
              | "NONE"
              | "OWNER",
          },
        };
      },
    })
  ),

  create_issue_comment_reaction: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        issue_number: z.number(),
        comment_id: z.number(),
        reaction: githubReactionSchema,
      }),
      description:
        "Create a reaction on an issue comment. This will not work for pull request comments. Do not use this tool unless explicitly instructed to do so.",
      execute: async (args, opts) => {
        await (
          await octokit()
        ).request(
          "POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions",
          {
            owner: args.owner,
            repo: args.repo,
            comment_id: args.comment_id,
            content: args.reaction,
            request: {
              signal: opts.abortSignal,
            },
          }
        );
        return {
          success: true,
        };
      },
    })
  ),

  create_pull_request_review_comment_reaction: toolWithOctokit(
    ({ octokit }) => ({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        comment_id: z.number(),
        reaction: githubReactionSchema,
      }),
      description:
        "Create a reaction on a pull request comment. Do not use this tool unless explicitly instructed to do so.",
      execute: async (args, opts) => {
        await (
          await octokit()
        ).request(
          "POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions",
          {
            owner: args.owner,
            repo: args.repo,
            comment_id: args.comment_id,
            content: args.reaction,
            request: {
              signal: opts.abortSignal,
            },
          }
        );
        return {
          success: true,
        };
      },
    })
  ),

  list_pull_request_review_comments: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        pull_number: z.number(),
        page: z.number(),
        per_page: z.number(),
        review_id: z.number(),
      }),
      description: "List comments on a pull request.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/pulls/{pull_number}/comments", {
          owner: args.owner,
          repo: args.repo,
          pull_number: args.pull_number,
          page: args.page,
          per_page: args.per_page,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          comments: response.data
            .filter((comment) => {
              return comment.pull_request_review_id === args.review_id;
            })
            .map((comment) => ({
              id: comment.id,
              body: comment.body ?? "",
              created_at: comment.created_at,
              updated_at: comment.updated_at,
              user: {
                login: comment.user?.login ?? "",
              },
              author_association: comment.author_association as
                | "COLLABORATOR"
                | "CONTRIBUTOR"
                | "FIRST_TIMER"
                | "FIRST_TIME_CONTRIBUTOR"
                | "MEMBER"
                | "NONE"
                | "OWNER",
              path: comment.path as string,
              start_line: comment.start_line ?? comment.line ?? -1,
              end_line: comment.line ?? -1,
              diff_hunk: comment.diff_hunk as string,
            })),
        };
      },
    })
  ),

  create_pull_request_review_comment_reply: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        pull_number: z.number(),
        comment_id: z.number(),
        body: z.string(),
      }),
      description: "Create a reply to a pull request comment.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request(
          "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
          {
            owner: args.owner,
            repo: args.repo,
            pull_number: args.pull_number,
            comment_id: args.comment_id,
            body: args.body,
            request: {
              signal: opts.abortSignal,
            },
          }
        );
        return {
          comment: {
            id: response.data.id,
            body: response.data.body ?? "",
            created_at: response.data.created_at,
            updated_at: response.data.updated_at,
            user: {
              login: response.data.user?.login ?? "",
            },
            author_association: response.data.author_association as
              | "COLLABORATOR"
              | "CONTRIBUTOR"
              | "FIRST_TIMER"
              | "FIRST_TIME_CONTRIBUTOR"
              | "MEMBER"
              | "NONE"
              | "OWNER",
            in_reply_to_id: response.data.in_reply_to_id as number,
            diff_hunk: response.data.diff_hunk as string,
            path: response.data.path as string,
            position: response.data.position as number,
            original_position: response.data.original_position as number,
          },
        };
      },
    })
  ),

  get_pull_request_review: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        pull_number: z.number(),
        review_id: z.number(),
      }),
      description: "Get a review of a pull request.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request(
          "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
          {
            owner: args.owner,
            repo: args.repo,
            pull_number: args.pull_number,
            review_id: args.review_id,
            request: {
              signal: opts.abortSignal,
            },
          }
        );
        return {
          review: {
            author_association: response.data.author_association as
              | "COLLABORATOR"
              | "CONTRIBUTOR"
              | "FIRST_TIMER"
              | "FIRST_TIME_CONTRIBUTOR"
              | "MEMBER"
              | "NONE"
              | "OWNER",
            body: response.data.body ?? "",
            commit_id: response.data.commit_id ?? "",
            id: response.data.id,
            state: response.data.state as
              | "APPROVED"
              | "REQUEST_CHANGES"
              | "COMMENT",
            submitted_at: response.data.submitted_at as string,
            user: {
              login: response.data.user?.login ?? "",
            },
          },
        };
      },
    })
  ),

  list_pull_request_reviews: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        pull_number: z.number(),
      }),
      description: "List reviews of a pull request.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
          owner: args.owner,
          repo: args.repo,
          pull_number: args.pull_number,
          request: {
            signal: opts.abortSignal,
          },
        });
        return {
          reviews: response.data.map((review) => ({
            id: review.id,
            state: review.state as "APPROVED" | "REQUEST_CHANGES" | "COMMENT",
            author_association: review.author_association as
              | "COLLABORATOR"
              | "CONTRIBUTOR"
              | "FIRST_TIMER"
              | "FIRST_TIME_CONTRIBUTOR"
              | "MEMBER"
              | "NONE"
              | "OWNER",
            body: review.body ?? "",
            commit_id: review.commit_id ?? "",
            submitted_at: review.submitted_at as string,
            user: {
              login: review.user?.login ?? "",
            },
          })),
        };
      },
    })
  ),

  list_organization_projects: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        org: z.string().describe("The organization name"),
        first: z
          .number()
          .min(1)
          .max(100)
          .describe("Number of projects to return"),
        after: z
          .string()
          .describe(
            "Cursor for pagination. Leave blank to start from the beginning."
          ),
      }),
      description: "List projects for an organization.",
      execute: async (args, opts) => {
        const result = await (
          await octokit()
        ).graphql(
          `query ($org: String!, $first: Int, $after: String) {
  organization(login: $org) {
    projectsV2(first: $first, after: $after) {
      totalCount
      pageInfo {
        startCursor
        endCursor
        hasNextPage
        hasPreviousPage
      }
      nodes {
        id
        title
        createdAt
        creator {
          login
        }
        shortDescription
        number
        public
        readme
        repositories(first: 10) {
          nodes {
            name
            owner {
              login
            }
          }
        }
      }
    }
  }
        }`,
          {
            org: args.org,
            first: args.first,
            after: args.after,
            request: {
              signal: opts.abortSignal,
            },
          }
        );
        return {
          data: result,
        };
      },
    })
  ),

  list_organization_project_items: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        project_id: z.string(),
        first: z.number().min(1).max(100).describe("Number of items to return"),
        after: z
          .string()
          .describe(
            "Cursor for pagination. Leave blank to start from the beginning."
          ),
      }),

      description: "List items in a project.",
      execute: async (args, opts) => {
        const result = await (
          await octokit()
        ).graphql(
          `query ($project_id: ID!, $first: Int, $after: String) {
node(id: $project_id) {
    ... on ProjectV2 {
      items(first: $first, after: $after) {
        totalCount
        pageInfo {
          startCursor
          endCursor
          hasNextPage
          hasPreviousPage
        }
        nodes{
          id
          type
          createdAt
          updatedAt
          fieldValues(first:100) {
            nodes {
              ... on ProjectV2ItemFieldTextValue {
                text
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
              ...on ProjectV2ItemFieldDateValue {
                date
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
            }
          }
          content{
            ... on DraftIssue {
              title
              body
            }
            ...on Issue {
              title
              number
              state
              url
              createdAt
              updatedAt
              assignees(first: 10) {
                nodes{
                  login
                }
              }
            }
            ...on PullRequest {
              title
              number
              url
              state
              createdAt
              updatedAt              
              assignees(first: 10) {
                nodes{
                  login
                }
              }
            }
          }
        }
      }
    }
  }
}
        `,
          {
            project_id: args.project_id,
            first: args.first,
            after: args.after,
            request: {
              signal: opts.abortSignal,
            },
          }
        );
        return {
          data: result,
        };
      },
    })
  ),

  create_check_run: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        name: z.string().describe("The name of the check run"),
        head_sha: z.string().describe("The SHA of the commit to check"),
        status: z
          .enum(["queued", "in_progress", "completed"])
          .optional()
          .describe("The current status of the check run. Default: queued"),
        conclusion: z
          .enum([
            "success",
            "failure",
            "neutral",
            "cancelled",
            "skipped",
            "timed_out",
            "action_required",
          ])
          .optional()
          .describe(
            "Required if status is 'completed'. The final conclusion of the check."
          ),
        started_at: z
          .string()
          .optional()
          .describe("ISO 8601 timestamp when the check run began"),
        completed_at: z
          .string()
          .optional()
          .describe(
            "ISO 8601 timestamp when the check run completed. Required if status is 'completed'."
          ),
        details_url: z
          .string()
          .optional()
          .describe("URL with more details about the check run"),
        external_id: z
          .string()
          .optional()
          .describe("A reference for the run on your system"),
        output_title: z
          .string()
          .optional()
          .describe("Title of the check run output"),
        output_summary: z
          .string()
          .optional()
          .describe("Summary of the check run (supports Markdown)"),
        output_text: z
          .string()
          .optional()
          .describe("Details of the check run (supports Markdown)"),
        output_annotations: z
          .array(
            z.object({
              path: z.string().describe("The path of the file to annotate"),
              start_line: z
                .number()
                .describe("The start line of the annotation"),
              end_line: z.number().describe("The end line of the annotation"),
              start_column: z
                .number()
                .optional()
                .describe("The start column of the annotation"),
              end_column: z
                .number()
                .optional()
                .describe("The end column of the annotation"),
              annotation_level: z
                .enum(["notice", "warning", "failure"])
                .describe("The level of the annotation"),
              message: z
                .string()
                .describe("A short description of the feedback"),
              title: z
                .string()
                .optional()
                .describe("The title for the annotation"),
              raw_details: z
                .string()
                .optional()
                .describe("Details about the annotation"),
            })
          )
          .optional()
          .describe(
            "Annotations for the check run. Adds inline comments to code. Maximum 50 annotations per request."
          ),
        output_images: z
          .array(
            z.object({
              alt: z.string().describe("Alt text for the image"),
              image_url: z.string().describe("The URL of the image"),
              caption: z
                .string()
                .optional()
                .describe("A short image description"),
            })
          )
          .optional()
          .describe("Images to display in the check run output"),
        actions: z
          .array(
            z.object({
              label: z
                .string()
                .describe(
                  "The text to display on the button (max 20 characters)"
                ),
              description: z
                .string()
                .describe(
                  "A short description of the action (max 40 characters)"
                ),
              identifier: z
                .string()
                .describe(
                  "A reference for the action on the integrator's system (max 20 characters)"
                ),
            })
          )
          .optional()
          .describe(
            "Action buttons to display in the check run. Maximum 3 actions. These trigger the check_run.requested_action webhook."
          ),
      }),
      description:
        "Create a check run for a commit. Check runs provide rich integration with GitHub's UI, including annotations, images, and action buttons. Requires a GitHub App with checks:write permission.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("POST /repos/{owner}/{repo}/check-runs", {
          owner: args.owner,
          repo: args.repo,
          name: args.name,
          head_sha: args.head_sha,
          status: args.status ?? "queued",
          ...(args.started_at && { started_at: args.started_at }),
          ...(args.status === "completed" && {
            conclusion: args.conclusion,
            completed_at: args.completed_at,
          }),
          ...(args.details_url && { details_url: args.details_url }),
          ...(args.external_id && { external_id: args.external_id }),
          ...((args.output_title ||
            args.output_summary ||
            args.output_text ||
            args.output_annotations ||
            args.output_images) && {
            output: {
              title: args.output_title ?? "",
              summary: args.output_summary ?? "",
              ...(args.output_text && { text: args.output_text }),
              ...(args.output_annotations && {
                annotations: args.output_annotations,
              }),
              ...(args.output_images && { images: args.output_images }),
            },
          }),
          ...(args.actions && { actions: args.actions }),
          request: {
            signal: opts.abortSignal,
          },
        });

        return {
          check_run: {
            id: response.data.id,
            name: response.data.name,
            head_sha: response.data.head_sha,
            status: response.data.status as
              | "queued"
              | "in_progress"
              | "completed",
            conclusion: response.data.conclusion as
              | "success"
              | "failure"
              | "neutral"
              | "cancelled"
              | "skipped"
              | "timed_out"
              | "action_required"
              | null,
            html_url: response.data.html_url ?? "",
            details_url: response.data.details_url ?? "",
            started_at: response.data.started_at ?? "",
            completed_at: response.data.completed_at ?? "",
          },
        };
      },
    })
  ),

  update_check_run: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        check_run_id: z.number().describe("The ID of the check run to update"),
        status: z
          .enum(["queued", "in_progress", "completed"])
          .optional()
          .describe("The current status of the check run"),
        conclusion: z
          .enum([
            "success",
            "failure",
            "neutral",
            "cancelled",
            "skipped",
            "timed_out",
            "action_required",
          ])
          .optional()
          .describe(
            "Required if status is 'completed'. The final conclusion of the check."
          ),
        completed_at: z
          .string()
          .optional()
          .describe(
            "ISO 8601 timestamp when the check run completed. Required if status is 'completed'."
          ),
        details_url: z
          .string()
          .optional()
          .describe("URL with more details about the check run"),
        external_id: z
          .string()
          .optional()
          .describe("A reference for the run on your system"),
        output_title: z
          .string()
          .optional()
          .describe("Title of the check run output"),
        output_summary: z
          .string()
          .optional()
          .describe("Summary of the check run (supports Markdown)"),
        output_text: z
          .string()
          .optional()
          .describe("Details of the check run (supports Markdown)"),
        output_annotations: z
          .array(
            z.object({
              path: z.string().describe("The path of the file to annotate"),
              start_line: z
                .number()
                .describe("The start line of the annotation"),
              end_line: z.number().describe("The end line of the annotation"),
              start_column: z
                .number()
                .optional()
                .describe("The start column of the annotation"),
              end_column: z
                .number()
                .optional()
                .describe("The end column of the annotation"),
              annotation_level: z
                .enum(["notice", "warning", "failure"])
                .describe("The level of the annotation"),
              message: z
                .string()
                .describe("A short description of the feedback"),
              title: z
                .string()
                .optional()
                .describe("The title for the annotation"),
              raw_details: z
                .string()
                .optional()
                .describe("Details about the annotation"),
            })
          )
          .optional()
          .describe(
            "Annotations for the check run. Adds inline comments to code. Maximum 50 annotations per request."
          ),
        output_images: z
          .array(
            z.object({
              alt: z.string().describe("Alt text for the image"),
              image_url: z.string().describe("The URL of the image"),
              caption: z
                .string()
                .optional()
                .describe("A short image description"),
            })
          )
          .optional()
          .describe("Images to display in the check run output"),
        actions: z
          .array(
            z.object({
              label: z
                .string()
                .describe(
                  "The text to display on the button (max 20 characters)"
                ),
              description: z
                .string()
                .describe(
                  "A short description of the action (max 40 characters)"
                ),
              identifier: z
                .string()
                .describe(
                  "A reference for the action on the integrator's system (max 20 characters)"
                ),
            })
          )
          .optional()
          .describe(
            "Action buttons to display in the check run. Maximum 3 actions. These trigger the check_run.requested_action webhook."
          ),
      }),
      description:
        "Update a check run. Use this to update the status, conclusion, or output of an existing check run.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}", {
          owner: args.owner,
          repo: args.repo,
          check_run_id: args.check_run_id,
          ...(args.status && { status: args.status }),
          ...(args.status === "completed" && {
            conclusion: args.conclusion,
            completed_at: args.completed_at,
          }),
          ...(args.details_url && { details_url: args.details_url }),
          ...(args.external_id && { external_id: args.external_id }),
          ...((args.output_title ||
            args.output_summary ||
            args.output_text ||
            args.output_annotations ||
            args.output_images) && {
            output: {
              title: args.output_title ?? "",
              summary: args.output_summary ?? "",
              ...(args.output_text && { text: args.output_text }),
              ...(args.output_annotations && {
                annotations: args.output_annotations,
              }),
              ...(args.output_images && { images: args.output_images }),
            },
          }),
          ...(args.actions && { actions: args.actions }),
          request: {
            signal: opts.abortSignal,
          },
        });

        return {
          check_run: {
            id: response.data.id,
            name: response.data.name,
            head_sha: response.data.head_sha,
            status: response.data.status as
              | "queued"
              | "in_progress"
              | "completed",
            conclusion: response.data.conclusion as
              | "success"
              | "failure"
              | "neutral"
              | "cancelled"
              | "skipped"
              | "timed_out"
              | "action_required"
              | null,
            html_url: response.data.html_url ?? "",
            details_url: response.data.details_url ?? "",
            started_at: response.data.started_at ?? "",
            completed_at: response.data.completed_at ?? "",
          },
        };
      },
    })
  ),

  get_check_run: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        check_run_id: z.number().describe("The ID of the check run"),
      }),
      description: "Get a single check run by its ID.",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/check-runs/{check_run_id}", {
          owner: args.owner,
          repo: args.repo,
          check_run_id: args.check_run_id,
          request: {
            signal: opts.abortSignal,
          },
        });

        return {
          check_run: {
            id: response.data.id,
            name: response.data.name,
            head_sha: response.data.head_sha,
            status: response.data.status as
              | "queued"
              | "in_progress"
              | "completed",
            conclusion: response.data.conclusion as
              | "success"
              | "failure"
              | "neutral"
              | "cancelled"
              | "skipped"
              | "timed_out"
              | "action_required"
              | null,
            html_url: response.data.html_url ?? "",
            details_url: response.data.details_url ?? "",
            started_at: response.data.started_at ?? "",
            completed_at: response.data.completed_at ?? "",
            output: {
              title: response.data.output?.title ?? "",
              summary: response.data.output?.summary ?? "",
              text: response.data.output?.text ?? "",
            },
          },
        };
      },
    })
  ),

  list_check_runs_for_ref: toolWithOctokit(({ octokit }) =>
    tool({
      inputSchema: z.object({
        owner: z.string(),
        repo: z.string(),
        ref: z
          .string()
          .describe(
            "The commit reference (SHA, branch name, or tag name) to list check runs for"
          ),
        check_name: z.string().optional().describe("Filter by check run name"),
        status: z
          .enum(["queued", "in_progress", "completed"])
          .optional()
          .describe("Filter by status"),
        page: z.number().optional(),
        per_page: z.number().optional(),
      }),
      description:
        "List check runs for a specific reference (commit SHA, branch, or tag).",
      execute: async (args, opts) => {
        const response = await (
          await octokit()
        ).request("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", {
          owner: args.owner,
          repo: args.repo,
          ref: args.ref,
          check_name: args.check_name,
          status: args.status,
          page: args.page,
          per_page: args.per_page,
          request: {
            signal: opts.abortSignal,
          },
        });

        return {
          total_count: response.data.total_count,
          check_runs: response.data.check_runs.map((checkRun) => ({
            id: checkRun.id,
            name: checkRun.name,
            head_sha: checkRun.head_sha,
            status: checkRun.status as "queued" | "in_progress" | "completed",
            conclusion: checkRun.conclusion as
              | "success"
              | "failure"
              | "neutral"
              | "cancelled"
              | "skipped"
              | "timed_out"
              | "action_required"
              | null,
            html_url: checkRun.html_url ?? "",
            details_url: checkRun.details_url ?? "",
            started_at: checkRun.started_at ?? "",
            completed_at: checkRun.completed_at ?? "",
          })),
        };
      },
    })
  ),
};
