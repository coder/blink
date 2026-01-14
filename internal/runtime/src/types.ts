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
