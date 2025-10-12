// Error messages constants
export const ERROR_MESSAGES = {
  // VercelReceiver errors
  SIGNING_SECRET_REQUIRED:
    "SLACK_SIGNING_SECRET is required for VercelReceiver",
  APP_NOT_INITIALIZED: "App not initialized",
  REQUEST_TIMEOUT: "Request timeout",
  EVENT_NOT_ACKNOWLEDGED: "Event not acknowledged within timeout period",

  // Header validation errors
  MISSING_REQUIRED_HEADER: (header: string) =>
    `Missing required header: ${header}`,

  // Generic fallback errors
  REQUEST_VERIFICATION_FAILED: "Request verification failed",
  INTERNAL_SERVER_ERROR: "Internal server error",
  INTERNAL_SERVER_ERROR_HANDLER: "Internal Server Error",
  ACKNOWLEDGMENT_ERROR: "Error in acknowledgment handler",
  CREATE_HANDLER_ERROR: "Error in createHandler:",

  // Error type names
  TYPES: {
    RECEIVER_ERROR: "ReceiverError",
    SIGNATURE_VERIFICATION_ERROR: "SignatureVerificationError",
    REQUEST_PARSING_ERROR: "RequestParsingError",
    UNEXPECTED_ERROR: "UnexpectedError",
    HANDLER_ERROR: "HandlerError",
  },
} as const;

export class ReceiverError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = ERROR_MESSAGES.TYPES.RECEIVER_ERROR;
  }
}

export class RequestParsingError extends ReceiverError {
  constructor(message: string = "Failed to parse request") {
    super(message, 400);
    this.name = ERROR_MESSAGES.TYPES.REQUEST_PARSING_ERROR;
  }
}

/**
 * Determines the appropriate HTTP status code for a given error.
 * @param error The error to get status code for
 * @returns HTTP status code
 */
export function getStatusCode(error: unknown): number {
  if (error instanceof ReceiverError) {
    return error.statusCode;
  }

  // External error types from @slack/bolt
  if (error && typeof error === "object") {
    const errorName =
      error.constructor?.name || (error as { name?: string }).name;
    switch (errorName) {
      case "ReceiverAuthenticityError":
        return 401;
      case "ReceiverMultipleAckError":
        return 500;
      case "RequestParsingError":
        return 400;
      case "SignatureVerificationError":
        return 400;
      default:
        return 500;
    }
  }

  return 500;
}

/**
 * Gets the error message for response.
 * @param error The error to get message for
 * @returns Error message string
 */
export function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return ERROR_MESSAGES.INTERNAL_SERVER_ERROR;
}

/**
 * Gets the error type for response.
 * @param error The error to get type for
 * @returns Error type string
 */
export function getErrorType(error: unknown): string {
  if (error && typeof error === "object") {
    const ctorName = (error as { constructor?: { name?: string } }).constructor
      ?.name;
    const nameProp = (error as { name?: string }).name;
    const errorName =
      ctorName ?? nameProp ?? ERROR_MESSAGES.TYPES.UNEXPECTED_ERROR;
    // Use "UnexpectedError" for generic Error instances, otherwise use the actual name
    return errorName === "Error"
      ? ERROR_MESSAGES.TYPES.UNEXPECTED_ERROR
      : errorName;
  }
  return ERROR_MESSAGES.TYPES.UNEXPECTED_ERROR;
}
