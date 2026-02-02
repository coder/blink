Use `bun` for all package management, test running, building, etc.

Use `bun run typecheck` to run type checking.

Use `bunx biome check <path-to-file>` to run lint when you modify code.

To create database migrations, edit internal/database/src/schema.ts and run `cd internal/database && bun run generate --name <migration-name>` to generate the migration files.

When you create new frontend components or modify them, update their Storybook stories too. When you create a new component, create a new story for it.
