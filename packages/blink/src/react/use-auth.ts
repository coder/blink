import { useCallback, useEffect, useRef, useState } from "react";
import Client from "@blink.so/api";
import { getAuthToken, setAuthToken, deleteAuthToken } from "../cli/lib/auth";

export interface UseAuthOptions {
  /**
   * Whether to automatically check auth status on mount.
   * @default true
   */
  readonly autoCheck?: boolean;

  /**
   * Callback when authentication status changes.
   */
  readonly onAuthChange?: (user: UserInfo | undefined) => void;

  /**
   * Callback when login URL is generated (for custom UI flows).
   */
  readonly onLoginUrl?: (url: string, id: string) => void;

  /**
   * Optional test path for auth token file (for testing only).
   * When set, uses this path instead of the default XDG config path.
   */
  readonly testAuthPath?: string;
}

export interface UserInfo {
  readonly email: string;
}

export interface UseAuth {
  /** Current user info if authenticated, undefined if not */
  readonly user: UserInfo | undefined;

  /** Current auth token (if any) */
  readonly token: string | undefined;

  /** Error message if any */
  readonly error: string | undefined;

  /**
   * Start the login flow. This will:
   * 1. Generate a login URL via the API
   * 2. Call onLoginUrl callback (if provided)
   * 3. Wait for authentication to complete
   * 4. Save the token and fetch user info
   *
   * @returns The authenticated user info
   */
  readonly login: () => Promise<UserInfo>;

  /**
   * Logout the current user by clearing the token.
   */
  readonly logout: () => void;
}

/**
 * Hook for managing Blink authentication state.
 * This is UI-agnostic and can be used in both TUI and Desktop apps.
 */
export default function useAuth(options: UseAuthOptions = {}): UseAuth {
  const { autoCheck = true, onAuthChange, onLoginUrl, testAuthPath } = options;

  const [user, setUser] = useState<UserInfo | undefined>();
  const [token, setToken] = useState<string | undefined>(() =>
    getAuthToken(testAuthPath)
  );
  const [error, setError] = useState<string | undefined>();

  // Use ref for callbacks to avoid recreating checkAuth on every render
  const onAuthChangeRef = useRef(onAuthChange);
  const onLoginUrlRef = useRef(onLoginUrl);

  useEffect(() => {
    onAuthChangeRef.current = onAuthChange;
    onLoginUrlRef.current = onLoginUrl;
  }, [onAuthChange, onLoginUrl]);

  const checkAuth = useCallback(async () => {
    setError(undefined);

    try {
      const currentToken = getAuthToken(testAuthPath);
      setToken(currentToken);

      if (!currentToken) {
        setUser(undefined);
        onAuthChangeRef.current?.(undefined);
        return;
      }

      const client = new Client({
        baseURL: "https://blink.coder.com",
      });
      client.authToken = currentToken;

      const userData = await client.users.me();
      const userInfo: UserInfo = { email: userData.email };
      setUser(userInfo);
      onAuthChangeRef.current?.(userInfo);
    } catch (err) {
      // Token is invalid or network error
      setUser(undefined);
      setError(err instanceof Error ? err.message : String(err));
      onAuthChangeRef.current?.(undefined);
    }
  }, [testAuthPath]);

  const login = useCallback(async (): Promise<UserInfo> => {
    setError(undefined);

    try {
      const client = new Client();

      // Start the auth process
      const tokenPromise = client.auth.token((url, id) => {
        onLoginUrlRef.current?.(url, id);
      });

      // Wait for the token
      const newToken = (await tokenPromise) as string;

      // Verify and fetch user info
      client.authToken = newToken;
      const userData = await client.users.me();

      // Save the token
      setAuthToken(newToken, testAuthPath);
      setToken(newToken);

      // Update state
      const userInfo: UserInfo = { email: userData.email };
      setUser(userInfo);
      onAuthChangeRef.current?.(userInfo);

      return userInfo;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      throw err;
    }
  }, [testAuthPath]);

  const logout = useCallback(() => {
    deleteAuthToken(testAuthPath);
    setToken(undefined);
    setUser(undefined);
    setError(undefined);
    onAuthChangeRef.current?.(undefined);
  }, [testAuthPath]);

  // Auto-check on mount
  useEffect(() => {
    if (autoCheck) {
      checkAuth();
    }
  }, [autoCheck, checkAuth]);

  return {
    user,
    token,
    error,
    login,
    logout,
  };
}
