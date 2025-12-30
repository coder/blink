import { useState, useEffect } from "react";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import Client from "@blink.so/api";

declare const require: any;

let cachedPath: string | undefined;

// XDG directories polyfill for desktop
function getAuthTokenConfigPath(): string {
  if (cachedPath) return cachedPath;

  try {
    const { app } = require("electron").remote || require("@electron/remote");
    const userDataPath = app.getPath("userData");
    cachedPath = join(userDataPath, "auth.json");
    return cachedPath;
  } catch (err) {
    throw new Error("Failed to get auth token path: " + err);
  }
}

export function getAuthToken(): string | undefined {
  try {
    const path = getAuthTokenConfigPath();
    if (existsSync(path)) {
      const data = readFileSync(path, "utf8");
      return JSON.parse(data).token;
    }
  } catch (err) {
    console.error("Failed to get auth token:", err);
  }
  return undefined;
}

export function setAuthToken(token: string) {
  try {
    const path = getAuthTokenConfigPath();
    if (!existsSync(dirname(path))) {
      mkdirSync(dirname(path), { recursive: true });
    }
    writeFileSync(
      path,
      JSON.stringify({
        _: "This is your Blink credentials file. DO NOT SHARE THIS FILE WITH ANYONE!",
        token,
      })
    );
  } catch (err) {
    console.error("Failed to set auth token:", err);
    throw err;
  }
}

export function clearAuthToken() {
  try {
    const path = getAuthTokenConfigPath();
    if (existsSync(path)) {
      const fs = require("fs");
      fs.unlinkSync(path);
    }
  } catch (err) {
    console.error("Failed to clear auth token:", err);
  }
}

export interface AuthState {
  token: string | undefined;
  email: string | undefined;
  status:
    | "initializing"
    | "idle"
    | "authenticating"
    | "authenticated"
    | "error";
  error: string | undefined;
  authUrl: string | undefined;
}

export interface UseAuthReturn extends AuthState {
  login: () => Promise<void>;
  logout: () => void;
  openAuthUrl: () => void;
}

export function useAuth(): UseAuthReturn {
  const [state, setState] = useState<AuthState>({
    token: undefined,
    email: undefined,
    status: "initializing",
    error: undefined,
    authUrl: undefined,
  });

  // Load token on mount
  useEffect(() => {
    const loadToken = async () => {
      const token = getAuthToken();
      if (token) {
        // Verify token is valid by fetching user info
        try {
          const client = new Client({
            baseURL: "https://blink.so",
          });
          client.authToken = token;
          const user = await client.users.me();

          setState({
            token,
            email: user.email,
            status: "authenticated",
            error: undefined,
            authUrl: undefined,
          });
          return;
        } catch (err) {
          // Token is invalid, clear it
          console.error("Token verification failed:", err);
          clearAuthToken();
        }
      }

      setState({
        token: undefined,
        email: undefined,
        status: "idle",
        error: undefined,
        authUrl: undefined,
      });
    };

    loadToken();
  }, []);

  const login = async () => {
    setState((prev) => ({
      ...prev,
      status: "authenticating",
      error: undefined,
    }));

    try {
      const client = new Client({
        baseURL: "https://blink.so",
      });

      // Start the auth process
      const tokenPromise = client.auth.token((url: string, id: string) => {
        // Auto-open browser when URL is received
        const { shell } = require("electron");
        shell.openExternal(url);

        setState((prev) => ({
          ...prev,
          authUrl: url,
        }));
      });

      // Wait for the token
      const receivedToken = (await tokenPromise) as string;

      // Verify the token
      client.authToken = receivedToken;
      const user = await client.users.me();

      // Save the token
      setAuthToken(receivedToken);

      setState({
        token: receivedToken,
        email: user.email,
        status: "authenticated",
        error: undefined,
        authUrl: undefined,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  const logout = () => {
    clearAuthToken();
    setState({
      token: undefined,
      email: undefined,
      status: "idle",
      error: undefined,
      authUrl: undefined,
    });
  };

  const openAuthUrl = () => {
    if (state.authUrl) {
      const { shell } = require("electron");
      shell.openExternal(state.authUrl);
    }
  };

  return {
    ...state,
    login,
    logout,
    openAuthUrl,
  };
}
