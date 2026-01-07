// This is for defining additional env vars that are not always included in dev.
declare namespace Cloudflare {
  interface Env {
    // The base URL for the Blink API.
    // On localhost, this is http://localhost:3000.
    // On production, this is https://blink.coder.com.
    BLINK_BASE_URL?: string;

    // Used for tests.
    SLACK_API_BASE_URL?: string;

    BROWSERBASE_API_KEY?: string;
    BROWSERBASE_PROJECT_ID?: string;
    DAYTONA_API_KEY?: string;
    MORPH_API_KEY?: string;
    OPENAI_BASE_URL?: string;
    OPENAI_API_KEY?: string;
    GOOGLE_BASE_URL?: string;
    GOOGLE_API_KEY?: string;
    XAI_API_KEY?: string;
    XAI_BASE_URL?: string;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_BASE_URL?: string;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_BASE_URL?: string;
    ELEVENLABS_API_KEY?: string;
    AI_GATEWAY_API_KEY?: string;
    AI_GATEWAY_BASE_URL?: string;

    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    AWS_REGION?: string;
    AWS_LAMBDA_ROLE_ARN?: string;

    LOCAL_SHIMS_URL?: string;

    CLICKHOUSE_HOST?: string;
    CLICKHOUSE_USERNAME?: string;
    CLICKHOUSE_PASSWORD?: string;
    CLICKHOUSE_DATABASE?: string;
  }
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Env extends Cloudflare.Env {}
