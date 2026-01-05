ALTER TABLE "agent" ADD COLUMN "slack_verification" jsonb;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "github_app_setup" jsonb;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "onboarding_state" jsonb;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "integrations_state" jsonb;