import type { ChatResponse } from "../types";

/**
 * CustomChatResponseError is thrown by us to man-in-the-middle
 * the chat response.
 *
 * This is used by tool approvals, for example.
 */
export class CustomChatResponseError extends Error {
  constructor(
    message: string,
    public readonly response: ChatResponse<any>
  ) {
    super(message);
  }
}
