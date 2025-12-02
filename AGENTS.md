# Blink Development

## 1 Repository Overview

Blink is a Bun-powered monorepo managed via Bun workspaces (see `package.json → workspaces`). Each top-level package has a focused responsibility:

| Package              | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `packages/site/`     | Next.js App Router front-end (Tailwind, React server & client components) |
| `packages/worker/`   | Cloudflare Worker back-end (chat, webhooks, file uploads, etc.)           |
| `packages/database/` | Drizzle-based PostgreSQL access layer & migrations                        |
| Other `packages/*`   | Supporting SDKs, CLIs, event helpers, etc.                                |

Top-level scripts (`/scripts/*.ts`) orchestrate local tasks (DB, data dumps, etc.). `main` is always deployable.

## 2 Local Development

@cmux: Always run `bun i` when beginning to install packages. Pull all submodules before you begin as well. They are needed for development.

Test: `bun test`
Format: `bun format`
Typecheck: `bun typecheck`

All three _must_ work before CI will pass.

## 3 Coding Conventions

• **Formatting & linting** – Prettier is the single source of style; run `bun format` before committing. No ESLint rules are enforced beyond TS‐strictness.

• **Imports** – Use absolute path aliases:

- Front-end: `@/lib/foo`, `@/components/Bar`.
- DB: `@database/...` (provided by `packages/database/tsconfig.json`).
- Worker: `@worker/...`.
  Relative `../..` chains are discouraged except inside tests.

• **React / Next**

- Functional components only.
- Tailwind for styling; avoid extra CSS files. Rare global styles go in `packages/site/app/globals.css`.
- Memoisation (`React.memo`, `useMemo`) only where **obviously** valuable.

• **Comments** – Keep them Go-style (`//`) and minimal. Code should be self-explanatory.

• **Logging** – `console.log` is sufficient for now; avoid external logging services unless discussed first.

• **Testing**

- No wait/sleep – favor determinism.
- Flat structure – avoid deeply nested `describe` blocks.
- No duplicative naming – if a file is named "Example", the tests do not need to start with "Example –".
- Isolation – never call external network APIs in unit tests. Use local mocks (see `packages/*/*.mock.ts`).
- Database – use the helpers in `packages/database/test.ts` for setup/teardown. Never hit a live DB.

• **Database**

- Never write queries outside of `querier.ts`. These are centralized for easy migrations.
- NEVER write manual migrations. Always adjust `schema.ts` and use `cd packages/database/ && bun generate`. Format afterwards.

• **API**

- All API routes go in `packages/api/`. These are consumed and injected by the Worker, but are intentionally separated.
- Do not make API routes in `packages/site/` - ever.

## 4 Commit & PR Etiquette

• Write clear, concise commit messages (prefixes like `feat:`, `fix:` are welcome but optional). Squash or merge—author’s choice.

• CI (GitHub Actions) runs `bun format:check`, `bun typecheck`, and `bun test` on every PR; **all must pass** before merging. There are **no pre-commit hooks**, so run these commands locally or let CI catch issues.

• Keep the default branch (`main`) green; avoid merging failing builds.

• Mention any migrations or required env-vars in the PR description.

## 5 AI-Generated Content Attribution

When creating public operations (commits, PRs, issues), always include:

- 🤖 emoji in the title
- "_Generated with `cmux`_" in the body (if applicable)

This ensures transparency about AI-generated contributions.

---

## 6 PR Management

After submitting or updating PRs, **always check merge status**:

```bash
gh pr view <number> --json mergeable,mergeStateStatus | jq '.'
```

This is especially important with rapid development where branches quickly fall behind.

**Wait for PR checks to complete:**

```bash
./scripts/wait_pr_checks.sh <pr_number>
```

This script polls every 5 seconds and fails immediately on CI failure, bad merge status, or unresolved review comments. It will notify you when the PR is ready to merge.

**Key status values:**

- `mergeable: "MERGEABLE"` = No conflicts, can merge
- `mergeable: "CONFLICTING"` = Has conflicts, needs resolution
- `mergeStateStatus: "CLEAN"` = Ready to merge ✅
- `mergeStateStatus: "BLOCKED"` = Waiting for CI checks
- `mergeStateStatus: "BEHIND"` = Branch is behind base, rebase needed
- `mergeStateStatus: "DIRTY"` = Has conflicts

**If branch is behind:**

```bash
git fetch origin
git rebase origin/main
git push --force-with-lease
```

**ALWAYS AWAIT PRs UNTIL THEY PASS, OR YOU GET STUCK**

### ⚠️ NEVER Auto-Merge PRs

**DO NOT** enable auto-merge (`gh pr merge --auto`) or merge PRs (`gh pr merge`) without **explicit user instruction**.

Reason: PRs may need human review, discussion, or additional changes based on review comments (e.g., Codex feedback). Always:

1. Submit the PR
2. Wait for checks to pass
3. Report PR status to user
4. **Wait for user to decide** whether to merge

Only merge if the user explicitly says "merge it" or similar.

### Writing PR Descriptions

Write PR bodies for **busy reviewers**. Be concise and avoid redundancy:

- **Each section should add new information** - Don't restate the same thing in different words
- **Structure emerges from content** - Some fixes need problem/solution/testing, others just need "what changed and why"
- **If it's obvious, omit it** - Problem obvious from solution? Don't state it. Solution obvious from problem? Skip to implementation details.

❌ **Bad** (redundant):

```
Problem: Markdown rendering is slow, causing 50ms tasks
Solution: Make markdown rendering faster
Impact: Reduces task time to <16ms
```

✅ **Good** (each section adds value):

```
ReactMarkdown was re-parsing content on every parent render because plugin arrays
were created fresh each time. Moved to module scope for stable references.

Verify with React DevTools Profiler - MarkdownCore should only re-render when content changes.
```

## 7 Design

- **Avoid using too many font sizes** - this makes it visually difficult for the user.
- **Avoid using bold** - Bold expresses a really strong signal to the user, only use bold when it's truly very important to.
- **Density** - Blink is a platform for developers - developers use interfaces like VS Code and Cursor, which have visual density and highly idiomatic user-experience.
- **Styling** - Aim to make things beautiful by making them simple. Think like Apple.
