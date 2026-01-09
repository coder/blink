// BlinkInvocationTokenHeader is the header that contains
// the invocation token for the agent.
//
// This must be used to send requests from the Lambda to the API.
export const BlinkInvocationTokenHeader = "x-blink-invocation-token";

// This is only used for tests, but maybe someday
// we'll change the API server and be very happy.
export const InternalAPIServerURLEnvironmentVariable =
  "INTERNAL_BLINK_API_SERVER_URL";

export const InternalAPIServerListenPortEnvironmentVariable =
  "INTERNAL_BLINK_API_SERVER_LISTEN_PORT";

// BlinkDeploymentTokenEnvironmentVariable is the environment variable
// that contains the deployment token for the agent.
export const BlinkDeploymentTokenEnvironmentVariable = "BLINK_DEPLOYMENT_TOKEN";
