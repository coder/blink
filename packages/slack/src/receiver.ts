import {
  type AckFn,
  type App,
  ReceiverAuthenticityError,
  type ReceiverEvent,
  ReceiverMultipleAckError,
  type StringIndexed,
  verifySlackRequest,
} from "@slack/bolt";
import { ConsoleLogger, type Logger, LogLevel } from "@slack/logger";
import { waitUntil } from "blink";
import {
  ERROR_MESSAGES,
  getErrorMessage,
  getErrorType,
  getStatusCode,
  ReceiverError,
  RequestParsingError,
} from "./errors";

const LOG_PREFIX = "[@blink-sdk/slack]";
const ACK_TIMEOUT_MS = 3001;
const SLACK_RETRY_NUM_HEADER = "x-slack-retry-num";
const SLACK_RETRY_REASON_HEADER = "x-slack-retry-reason";
const SLACK_TIMESTAMP_HEADER = "x-slack-request-timestamp";
const SLACK_SIGNATURE_HEADER = "x-slack-signature";

/**
 * A Slack Bolt receiver implementation designed for serverless environments.
 * Handles Slack events, interactions, and slash commands with automatic request verification,
 * background processing, and timeout management.
 *
 * @example
 * ```typescript
 * import { App } from '@slack/bolt';
 * import { Receiver } from '@blink-sdk/slack';
 *
 * const app = new App({
 *   token: process.env.SLACK_BOT_TOKEN,
 *   signingSecret: process.env.SLACK_SIGNING_SECRET,
 * });
 *
 * const receiver = new Receiver();
 *
 * export default async function handler(req: Request) {
 *   return receiver.handle(app, req);
 * }
 * ```
 */
export class Receiver {
  private readonly signingSecret: string;
  private readonly signatureVerification: boolean;
  private readonly logger: Logger;
  private readonly ackTimeoutMs: number;
  private app?: App;

  /**
   * Creates a new Receiver instance.
   *
   * @param options - Configuration options for the receiver
   * @throws {ReceiverError} When signing secret is not provided
   *
   * @example
   * ```typescript
   * const receiver = new Receiver();
   * ```
   */
  public constructor({
    signingSecret = process.env.SLACK_SIGNING_SECRET,
    signatureVerification = true,
    logLevel = LogLevel.INFO,
  }: {
    signingSecret?: string;
    signatureVerification?: boolean;
    logLevel?: LogLevel;
  } = {}) {
    if (!signingSecret) {
      throw new ReceiverError(ERROR_MESSAGES.SIGNING_SECRET_REQUIRED);
    }

    this.signingSecret = signingSecret;
    this.signatureVerification = signatureVerification;
    this.logger = this.createScopedLogger(new ConsoleLogger(), logLevel);
    this.ackTimeoutMs = ACK_TIMEOUT_MS;
    this.logger.debug("Receiver initialized");
  }

  /**
   * Initializes the receiver with a Slack Bolt app instance.
   * This method is called automatically by the Bolt framework.
   *
   * @param app - The Slack Bolt app instance
   */
  public init(app: App): void {
    this.app = app;
    this.logger.debug("App initialized in Receiver");
  }

  /**
   * Starts the receiver. This method is called automatically by the Bolt framework.
   */
  public async start(): Promise<void> {
    this.logger.debug("Receiver started");
  }

  /**
   * Stops the receiver. This method is called automatically by the Bolt framework.
   */
  public async stop(): Promise<void> {
    this.logger.debug("Receiver stopped");
  }

  /**
   * Handles incoming Slack requests and returns a response.
   *
   * @param app - The Slack Bolt app instance (optional if init() was called)
   * @param req - The incoming request
   * @returns A promise that resolves to a Response
   */
  public async handle(app: App | Request, req?: Request): Promise<Response> {
    // Handle both signatures: handle(app, req) and handle(req) when init() was called
    let actualApp: App;
    let actualReq: Request;

    if (req === undefined) {
      // handle(req) signature - use initialized app
      if (!this.app) {
        throw new ReceiverError(ERROR_MESSAGES.APP_NOT_INITIALIZED, 500);
      }
      actualApp = this.app;
      actualReq = app as Request;
    } else {
      // handle(app, req) signature
      actualApp = app as App;
      actualReq = req;
    }

    try {
      const rawBody = await actualReq.text();

      if (this.signatureVerification) {
        this.verifyRequest(actualReq, rawBody);
      }

      const body = await this.parseRequestBody(actualReq, rawBody);

      if (body.type === "url_verification") {
        this.logger.debug("Handling URL verification challenge");
        return Response.json({ challenge: body.challenge });
      }

      return await this.handleSlackEvent(actualApp, actualReq, body);
    } catch (error) {
      return this.handleError(error);
    }
  }

  private async parseRequestBody(
    req: Request,
    rawBody: string
  ): Promise<StringIndexed> {
    const contentType = req.headers.get("content-type");

    try {
      if (contentType === "application/x-www-form-urlencoded") {
        const parsedBody: StringIndexed = {};
        const params = new URLSearchParams(rawBody);

        for (const [key, value] of params.entries()) {
          parsedBody[key] = value;
        }

        if (typeof parsedBody.payload === "string") {
          return JSON.parse(parsedBody.payload);
        }
        return parsedBody;
      }
      if (contentType === "application/json") {
        return JSON.parse(rawBody);
      }

      this.logger.warn(`Unexpected content-type detected: ${contentType}`);

      return JSON.parse(rawBody);
    } catch (e) {
      throw new RequestParsingError(
        `Failed to parse body as JSON data for content-type: ${contentType}. Error: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
  }

  private async handleSlackEvent(
    app: App,
    req: Request,
    body: StringIndexed
  ): Promise<Response> {
    let isAcknowledged = false;
    let responseResolver: (value: Response) => void;
    let responseRejecter: (error: Error) => void;

    const responsePromise = new Promise<Response>((resolve, reject) => {
      responseResolver = resolve;
      responseRejecter = reject;
    });

    // Slack requires an acknowledgment from your app within 3 seconds
    const timeoutId = setTimeout(() => {
      if (!isAcknowledged) {
        this.logger.error(ERROR_MESSAGES.EVENT_NOT_ACKNOWLEDGED);
        const error = new ReceiverError(ERROR_MESSAGES.REQUEST_TIMEOUT, 408);
        console.log("rejecting timeout error", error);
        responseRejecter(error);
      }
    }, this.ackTimeoutMs);

    // Create acknowledgment function
    const ackFn: AckFn<StringIndexed> = async (responseBody) => {
      this.logger.debug(`ack() call begins (body: ${responseBody})`);
      if (isAcknowledged) {
        throw new ReceiverMultipleAckError();
      }

      isAcknowledged = true;
      clearTimeout(timeoutId);

      try {
        let body: string | undefined;
        let status: number = 200;
        if (typeof responseBody === "undefined") {
          body = undefined;
          status = 204;
        } else if (typeof responseBody === "string") {
          body = responseBody;
        } else {
          body = JSON.stringify(responseBody);
        }
        const response = new Response(body, {
          status,
          headers: {
            "Content-Type": "application/json",
          },
        });

        responseResolver(response);
      } catch (error) {
        this.logger.error(ERROR_MESSAGES.ACKNOWLEDGMENT_ERROR, error);
        responseRejecter(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    };

    const event = this.createSlackReceiverEvent({
      body,
      headers: req.headers,
      ack: ackFn,
      request: req,
    });

    waitUntil(
      app.processEvent(event).catch((error) => {
        return this.handleError(error);
      })
    );

    try {
      return await responsePromise;
    } catch (error) {
      return this.handleError(error);
    }
  }

  private verifyRequest(req: Request, body: string): void {
    const timestamp = req.headers.get(SLACK_TIMESTAMP_HEADER);
    const signature = req.headers.get(SLACK_SIGNATURE_HEADER);

    if (!signature) {
      throw new ReceiverAuthenticityError(
        ERROR_MESSAGES.MISSING_REQUIRED_HEADER(SLACK_SIGNATURE_HEADER)
      );
    }

    if (!timestamp) {
      throw new ReceiverAuthenticityError(
        ERROR_MESSAGES.MISSING_REQUIRED_HEADER(SLACK_TIMESTAMP_HEADER)
      );
    }

    try {
      verifySlackRequest({
        signingSecret: this.signingSecret,
        body,
        headers: {
          "x-slack-signature": signature,
          "x-slack-request-timestamp": Number.parseInt(timestamp, 10),
        },
        logger: this.logger,
      });
    } catch (error) {
      throw new ReceiverAuthenticityError(
        error instanceof Error
          ? error.message
          : "Failed to verify request signature"
      );
    }
  }

  private createSlackReceiverEvent({
    body,
    headers,
    ack,
    request,
  }: {
    body: StringIndexed;
    headers: Headers;
    ack: AckFn<StringIndexed>;
    request: Request;
  }): ReceiverEvent {
    const retryNum = headers.get(SLACK_RETRY_NUM_HEADER) || "0";
    const retryReason = headers.get(SLACK_RETRY_REASON_HEADER) || "";

    return {
      body,
      ack,
      retryNum: Number(retryNum),
      retryReason,
      customProperties: {},
    };
  }

  private handleError(error: unknown): Response {
    const errorMessage = getErrorMessage(error);
    const errorType = getErrorType(error);
    const errorStatusCode = getStatusCode(error);

    this.logger.error(error);
    return new Response(
      JSON.stringify({
        error: errorMessage,
        type: errorType,
      }),
      {
        status: errorStatusCode,
        headers: { "content-type": "application/json" },
      }
    );
  }

  private createScopedLogger(logger: Logger, logLevel: LogLevel): Logger {
    logger.setLevel(logLevel);

    return {
      ...logger,
      error: (...args) => logger.error?.(LOG_PREFIX, ...args),
      warn: (...args) => logger.warn?.(LOG_PREFIX, ...args),
      info: (...args) => logger.info?.(LOG_PREFIX, ...args),
      debug: (...args) => logger.debug?.(LOG_PREFIX, ...args),
      setLevel: logger.setLevel,
      getLevel: logger.getLevel,
    };
  }
}
