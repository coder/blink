import { z } from "zod";
import type Client from "../../client.browser";
import { assertResponseStatus } from "../../client-helper";

/**
 * Cookie name for the session token.
 * Always use the same cookie name regardless of environment.
 */
export const SESSION_COOKIE_NAME = "blink_session_token";

/**
 * Secure flag for session cookies.
 * Set to false for now to allow development over HTTP.
 */
export const SESSION_SECURE = false;

export const schemaSignInWithCredentialsRequest = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const schemaSignInWithCredentialsResponse = z.object({
  ok: z.boolean(),
  url: z.string(),
});

export const schemaVerifyEmailRequest = z.object({
  code: z.string(),
});

export const schemaVerifyEmailResponse = z.object({
  ok: z.boolean(),
});

export const schemaResetPasswordRequest = z.object({
  password: z.string().min(8),
});

export const schemaResetPasswordResponse = z.object({
  ok: z.boolean(),
});

export const schemaRequestEmailChangeRequest = z.object({
  currentPassword: z.string(),
  newEmail: z.string().email(),
});

export const schemaRequestEmailChangeResponse = z.object({
  ok: z.boolean(),
});

export const schemaVerifyEmailChangeRequest = z.object({
  code: z.string(),
});

export const schemaVerifyEmailChangeResponse = z.object({
  ok: z.boolean(),
});

export const schemaSignupRequest = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  redirect: z.string().optional(),
});

export const schemaSignupResponse = z.object({
  ok: z.boolean(),
  redirect_url: z.string(),
});

export const schemaResendEmailVerificationResponse = z.object({
  ok: z.boolean(),
});

export const schemaRequestPasswordResetRequest = z.object({
  email: z.string().email(),
});

export const schemaRequestPasswordResetResponse = z.object({
  ok: z.boolean(),
  redirect_url: z.string(),
});

export const schemaResendPasswordResetResponse = z.object({
  ok: z.boolean(),
});

export const schemaAuthProvider = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["credentials", "oauth"]),
});

export const schemaGetProvidersResponse = z.record(
  z.string(),
  schemaAuthProvider
);

export type SignInWithCredentialsRequest = z.infer<
  typeof schemaSignInWithCredentialsRequest
>;
export type SignInWithCredentialsResponse = z.infer<
  typeof schemaSignInWithCredentialsResponse
>;
export type VerifyEmailRequest = z.infer<typeof schemaVerifyEmailRequest>;
export type VerifyEmailResponse = z.infer<typeof schemaVerifyEmailResponse>;
export type ResetPasswordRequest = z.infer<typeof schemaResetPasswordRequest>;
export type ResetPasswordResponse = z.infer<typeof schemaResetPasswordResponse>;
export type RequestEmailChangeRequest = z.infer<
  typeof schemaRequestEmailChangeRequest
>;
export type RequestEmailChangeResponse = z.infer<
  typeof schemaRequestEmailChangeResponse
>;
export type VerifyEmailChangeRequest = z.infer<
  typeof schemaVerifyEmailChangeRequest
>;
export type VerifyEmailChangeResponse = z.infer<
  typeof schemaVerifyEmailChangeResponse
>;
export type SignupRequest = z.infer<typeof schemaSignupRequest>;
export type SignupResponse = z.infer<typeof schemaSignupResponse>;
export type ResendEmailVerificationResponse = z.infer<
  typeof schemaResendEmailVerificationResponse
>;
export type RequestPasswordResetRequest = z.infer<
  typeof schemaRequestPasswordResetRequest
>;
export type RequestPasswordResetResponse = z.infer<
  typeof schemaRequestPasswordResetResponse
>;
export type ResendPasswordResetResponse = z.infer<
  typeof schemaResendPasswordResetResponse
>;
export type AuthProvider = z.infer<typeof schemaAuthProvider>;
export type GetProvidersResponse = z.infer<typeof schemaGetProvidersResponse>;

export default class Auth {
  private readonly client: Client;
  private readonly baseURL: URL;

  public constructor(client: Client, baseURL: URL) {
    this.client = client;
    this.baseURL = baseURL;
  }

  /**
   * token returns a JWT token for the current user.
   *
   * @param cb - Callback to receive the URL to authenticate with.
   * @param options - Options for the token request.
   * @returns A promise that resolves to a JWT token.
   */
  public async token(
    cb: (url: string, id: string) => void,
    options: {
      timeout: number;
    } = {
      timeout: 120_000,
    }
  ) {
    // Open a WebSocket connection to the server with an ID.
    // Client resolves token with a JWT.
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const ws = this.client.websocket(`/api/auth/token?id=${id}`);
      const url = new URL(`/auth?id=${id}`, this.baseURL);
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for the user to authenticate"));
      }, options.timeout);
      ws.onerror = (event) => {
        clearTimeout(timeout);
        console.log("error", event);
        reject(new Error("Failed to connect to server"));
      };
      ws.onopen = () => {
        cb(url.toString(), id);
      };
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") {
          return;
        }
        clearTimeout(timeout);
        resolve(event.data);
      };
    });
  }

  /**
   * signInWithCredentials signs in a user with email and password.
   *
   * @param request - The signin request.
   * @returns A promise that resolves to the login response.
   */
  public async signInWithCredentials(
    request: SignInWithCredentialsRequest
  ): Promise<SignInWithCredentialsResponse> {
    const response = await this.client.request(
      "POST",
      "/api/auth/signin/credentials",
      JSON.stringify(request)
    );

    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * verifyEmail verifies a user's email address with a verification code.
   * The verification token is read from the httpOnly cookie on the server.
   *
   * @param request - The verification request.
   * @returns A promise that resolves to the verification response.
   */
  public async verifyEmail(
    request: VerifyEmailRequest
  ): Promise<VerifyEmailResponse> {
    const response = await this.client.request(
      "POST",
      "/api/auth/verify-email",
      JSON.stringify(request)
    );

    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * resetPassword resets the user's password using the verified token from the cookie.
   *
   * @param request - The password reset request.
   * @returns A promise that resolves to the reset response.
   */
  public async resetPassword(
    request: ResetPasswordRequest
  ): Promise<ResetPasswordResponse> {
    const response = await this.client.request(
      "POST",
      "/api/auth/reset-password",
      JSON.stringify(request)
    );

    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * requestEmailChange requests a change of the user's email address.
   * Requires authentication - user ID is taken from the session.
   *
   * @param request - The email change request.
   * @returns A promise that resolves to the request response.
   */
  public async requestEmailChange(
    request: RequestEmailChangeRequest
  ): Promise<RequestEmailChangeResponse> {
    const response = await this.client.request(
      "POST",
      "/api/auth/request-email-change",
      JSON.stringify(request)
    );

    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * verifyEmailChange verifies the email change with a verification code.
   * Requires authentication - user ID is taken from the session.
   *
   * @param request - The email change verification request.
   * @returns A promise that resolves to the verification response.
   */
  public async verifyEmailChange(
    request: VerifyEmailChangeRequest
  ): Promise<VerifyEmailChangeResponse> {
    const response = await this.client.request(
      "POST",
      "/api/auth/verify-email-change",
      JSON.stringify(request)
    );

    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * signup creates a new user account with email and password.
   *
   * @param request - The signup request.
   * @returns A promise that resolves to the signup response with redirect URL.
   */
  public async signup(request: SignupRequest): Promise<SignupResponse> {
    const response = await this.client.request(
      "POST",
      "/api/auth/signup",
      JSON.stringify(request)
    );

    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * resendEmailVerification resends the email verification code.
   * The verification token is read from the httpOnly cookie on the server.
   *
   * @returns A promise that resolves to the response.
   */
  public async resendEmailVerification(): Promise<ResendEmailVerificationResponse> {
    const response = await this.client.request(
      "POST",
      "/api/auth/resend-email-verification",
      ""
    );

    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * requestPasswordReset initiates a password reset flow.
   *
   * @param request - The password reset request.
   * @returns A promise that resolves to the response with redirect URL.
   */
  public async requestPasswordReset(
    request: RequestPasswordResetRequest
  ): Promise<RequestPasswordResetResponse> {
    const response = await this.client.request(
      "POST",
      "/api/auth/request-password-reset",
      JSON.stringify(request)
    );

    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * resendPasswordReset resends the password reset code.
   * The reset token is read from the httpOnly cookie on the server.
   *
   * @returns A promise that resolves to the response.
   */
  public async resendPasswordReset(): Promise<ResendPasswordResetResponse> {
    const response = await this.client.request(
      "POST",
      "/api/auth/resend-password-reset",
      ""
    );

    await assertResponseStatus(response, 200);
    return response.json();
  }

  /**
   * getProviders returns the available authentication providers.
   *
   * @returns A promise that resolves to the providers.
   */
  public async getProviders(): Promise<GetProvidersResponse> {
    const response = await this.client.request("GET", "/api/auth/providers");

    await assertResponseStatus(response, 200);
    return response.json();
  }
}
