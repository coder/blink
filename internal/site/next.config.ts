import { config } from "dotenv";
import { writeFileSync } from "fs";
import type { NextConfig } from "next";
import path from "path";

const root = path.join(__dirname, "..", "..");
if (process.env.NODE_ENV === "development") {
  const output = config({
    path: path.join(root, ".env.local"),
  });
  // The app needs vars to work properly.
  if (output.error) {
    // Create a basic .env.local file with the required variables.
    writeFileSync(
      path.join(root, ".env.local"),
      `AUTH_SECRET=fake-secret
  NODE_ENV=development
  `
    );

    console.log("Created a basic .env.local file with the required variables.");
    console.log("Refer to .env.example to see variables that add features.");

    config({
      path: path.join(root, ".env.local"),
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withBundleAnalyzer = require("@next/bundle-analyzer")({ enabled: false });

const nextConfig: NextConfig = {
  experimental: {
    // ppr: true,
  },
  output: process.env.NEXT_OUTPUT as "standalone" | "export" | undefined,
  devIndicators: false,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        hostname: "avatars.githubusercontent.com",
      },
      {
        hostname: "github.com",
      },
      {
        hostname: "lh3.googleusercontent.com",
      },
      {
        hostname: "api.dicebear.com",
      },
      {
        hostname: "localhost",
      },
      {
        hostname: "blink.so",
      },
    ],
  },
  turbopack: {},
  async rewrites() {
    // Only proxy in development
    if (process.env.NODE_ENV === "development") {
      return {
        // For development, these should match the worker routes.
        // ../worker/wrangler.toml
        beforeFiles: [
          {
            source: "/api/legacy-chat-stream",
            destination: "http://localhost:8787/api/legacy-chat-stream",
          },
          {
            source: "/api/chat-read",
            destination: "http://localhost:8787/api/chat-read",
          },
          {
            source: "/api/chat-search",
            destination: "http://localhost:8787/api/chat-search",
          },
          {
            source: "/api/user-state",
            destination: "http://localhost:8787/api/user-state",
          },
          {
            // Just for testing.
            source: "/webhook/slack",
            destination: "http://localhost:8787/webhook/slack",
          },
          {
            // Just for testing.
            source: "/webhook/github",
            destination: "http://localhost:8787/webhook/github",
          },
          {
            source: "/api/connect",
            destination: "http://localhost:8787/api/connect",
          },
          {
            source: "/api/connect-client",
            destination: "http://localhost:8787/api/connect-client",
          },
          {
            source: "/api/connect-token",
            destination: "http://localhost:8787/api/connect-token",
          },
          {
            source: "/api/connect-chat",
            destination: "http://localhost:8787/api/connect-chat",
          },
          {
            source: "/static/:path*",
            destination: "http://localhost:8787/static/:path*",
          },
          {
            source: "/api/files/:path*",
            destination: "http://localhost:8787/api/files/:path*",
          },
          {
            source: "/api/text-to-speech",
            destination: "http://localhost:8787/api/text-to-speech",
          },
          {
            source: "/api/chats/:path*",
            destination: "http://localhost:8787/api/chats/:path*",
          },
          {
            source: "/api/messages/:path*",
            destination: "http://localhost:8787/api/messages/:path*",
          },
          {
            source: "/api/agents/:path*",
            destination: "http://localhost:8787/api/agents/:path*",
          },
          {
            source: "/api/chats/:path*",
            destination: "http://localhost:8787/api/chats/:path*",
          },
          {
            source: "/api/organizations/:path*",
            destination: "http://localhost:8787/api/organizations/:path*",
          },
          {
            source: "/api/auth/:path*",
            destination: "http://localhost:8787/api/auth/:path*",
          },
          {
            source: "/api/users/:path*",
            destination: "http://localhost:8787/api/users/:path*",
          },
        ],
      };
    }
    return [];
  },
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    const scriptSrc = [
      "'self'",
      "'unsafe-inline'",
      "https://js.stripe.com",
      "https://www.googletagmanager.com",
    ];
    if (isDev) {
      scriptSrc.push("'unsafe-eval'");
    }
    const connectSrc = [
      "'self'",
      "https:",
      "wss:",
      "https://js.stripe.com",
      "https://www.google-analytics.com",
    ];
    if (isDev) {
      connectSrc.push("ws:");
    }
    const csp = [
      "default-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      `script-src ${scriptSrc.join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: https://i.ytimg.com https://s.ytimg.com",
      "font-src 'self' data:",
      `connect-src ${connectSrc.join(" ")}`,
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://www.youtube-nocookie.com https://www.youtube.com",
      "upgrade-insecure-requests",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: csp,
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, context) => {
    // Comment this out to check why things are rendered.
    return config;

    if (context.dev && !context.isServer) {
      const whyDidYouRender = path.join(
        __dirname,
        "scripts",
        "why-did-you-render.ts"
      );
      const originalEntry = config.entry;
      config.entry = async () => {
        const entries = await originalEntry();
        if (
          entries["main-app"] &&
          !entries["main-app"].includes(whyDidYouRender)
        ) {
          entries["main-app"].push(whyDidYouRender);
        }
        return entries;
      };
    }
    return config;
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default withBundleAnalyzer(nextConfig);
