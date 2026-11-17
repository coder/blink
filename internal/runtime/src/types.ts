// BlinkInvocationTokenHeader is the header that contains
// the invocation token for the agent.
//
// This must be used to send requests from the Lambda to the API.
export const BlinkInvocationTokenHeader = "x-blink-invocation-token";

export const BlinkInvocationRunIDHeader = "x-blink-invocation-run-id";
export const BlinkInvocationStepIDHeader = "x-blink-invocation-step-id";
export const BlinkInvocationChatIDHeader = "x-blink-invocation-chat-id";

// This is only used for tests, but maybe someday
// we'll change the API server and be very happy.
export const InternalAPIServerURLEnvironmentVariable =
  "INTERNAL_BLINK_API_SERVER_URL";

// JSON object of extra HTTP headers sent to the Blink API server.
export const InternalAPIServerHeadersEnvironmentVariable =
  "INTERNAL_BLINK_API_SERVER_HEADERS";

/** Extra headers for server-side Blink clients, including the agent runtime. */
export function getServerHeaders(): Record<string, string> {
  const value = process.env[InternalAPIServerHeadersEnvironmentVariable];
  if (!value) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error();
    }
    for (const header of Object.values(parsed)) {
      if (typeof header !== "string") {
        throw new Error();
      }
    }
    // Validate header names and values, and normalize names for merging.
    return Object.fromEntries(new Headers(parsed as Record<string, string>));
  } catch {
    // Do not include the value or parser error: headers can contain secrets.
    throw new Error(
      `${InternalAPIServerHeadersEnvironmentVariable} must be a JSON object of valid HTTP header names and string values`
    );
  }
}

export const InternalAPIServerListenPortEnvironmentVariable =
  "INTERNAL_BLINK_API_SERVER_LISTEN_PORT";

// BlinkDeploymentTokenEnvironmentVariable is the environment variable
// that contains the deployment token for the agent.
export const BlinkDeploymentTokenEnvironmentVariable = "BLINK_DEPLOYMENT_TOKEN";

/**
 * @deprecated Legacy environment variable for auth token.
 * Used as fallback for older blink package versions that don't support
 * AsyncLocalStorage-based auth context. New code should use runWithAuth/getAuthToken.
 *
 * WARNING: This approach has race conditions with concurrent requests in Node.js.
 * It's safe for Lambda (single request at a time) but not for Node.js servers.
 */
export const BlinkInvocationAuthTokenEnvironmentVariable =
  "BLINK_INVOCATION_AUTH_TOKEN";
