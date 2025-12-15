# @blink-sdk/devhook

Expose local servers via a public URL. Perfect for webhooks, API testing, and development.

## Features

- **Secure URLs**: Client secrets are signed with HMAC-SHA256 to generate deterministic, unguessable subdomains
- **Flexible routing**: Support for wildcard subdomains (`abc123.devhook.example.com`) or subpath routing (`example.com/devhook/abc123`)
- **WebSocket support**: Full bidirectional WebSocket proxying
- **Persistent sessions**: Durable Object state survives restarts
- **Local testing**: Run the server locally with Node.js

## Installation

```bash
npm install @blink-sdk/devhook
```

## Client Usage

```typescript
import { DevhookClient } from "@blink-sdk/devhook";

const client = new DevhookClient({
  serverUrl: "https://devhook.example.com",
  secret: "my-secret-key",
  onRequest: async (req) => {
    // Forward to your local server
    const url = new URL(req.url);
    url.host = "localhost:3000";
    return fetch(new Request(url.toString(), req));
  },
  onConnect: ({ url, id }) => {
    console.log(`Devhook available at: ${url}`);
    console.log(`Devhook ID: ${id}`);
  },
  onDisconnect: () => {
    console.log("Disconnected from server");
  },
  onError: (error) => {
    console.error("Error:", error);
  },
});

const disposable = client.connect();

// When done:
// disposable.dispose();
```

## Server Deployment

### Cloudflare Workers (Production)

1. Clone this repository or copy the server files
2. Configure `wrangler.toml`:

```toml
name = "devhook-server"
main = "src/server/cloudflare.ts"
compatibility_date = "2025-01-01"

# For wildcard subdomains:
routes = [
  { pattern = "*.devhook.example.com/*", zone_name = "example.com" },
  { pattern = "devhook.example.com/*", zone_name = "example.com" }
]

[vars]
DEVHOOK_SECRET = "your-secure-server-secret"
DEVHOOK_BASE_URL = "https://devhook.example.com"
DEVHOOK_MODE = "wildcard"

[[durable_objects.bindings]]
name = "DEVHOOK_SESSION"
class_name = "DevhookSession"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["DevhookSession"]
```

3. Deploy:

```bash
wrangler deploy
```

### DNS Configuration (Wildcard Mode)

For wildcard subdomains, configure your DNS:

1. Add a wildcard CNAME record: `*.devhook.example.com` → your Cloudflare zone
2. Or use Cloudflare's automatic proxying

### Local Development

```typescript
import { createLocalServer } from "@blink-sdk/devhook/server/local";

const server = createLocalServer({
  port: 8080,
  secret: "server-secret",
  baseUrl: "http://localhost:8080",
  mode: "subpath", // Easier for local testing
  onReady: (port) => {
    console.log(`Devhook server running on port ${port}`);
  },
  onClientConnect: (id) => {
    console.log(`Client connected: ${id}`);
  },
  onClientDisconnect: (id) => {
    console.log(`Client disconnected: ${id}`);
  },
});

// Later: server.close();
```

## How It Works

### URL Generation

1. Client provides a secret
2. Server signs the secret with HMAC-SHA256 using its own secret
3. The signature is base64url-encoded and truncated to 16 characters
4. This becomes the devhook ID (subdomain or path prefix)

This means:
- The same client secret always produces the same URL
- URLs cannot be guessed without knowing the client secret
- Different server secrets produce different URLs

### Request Flow

```
External Request
      │
      ▼
┌─────────────────┐
│ Cloudflare Edge │
│   (Worker)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Durable Object  │
│ (Session State) │
└────────┬────────┘
         │ WebSocket
         ▼
┌─────────────────┐
│ Devhook Client  │
│ (Your Machine)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Local Server   │
│ (localhost:3000)│
└─────────────────┘
```

## API Reference

### DevhookClient

```typescript
interface DevhookClientOptions {
  /** The devhook server URL */
  serverUrl: string;

  /** Client secret for URL generation */
  secret: string;

  /** Handle incoming proxied requests */
  onRequest: (request: Request) => Promise<Response>;

  /** Called when connected (with public URL) */
  onConnect?: (info: { url: string; id: string }) => void;

  /** Called when disconnected */
  onDisconnect?: () => void;

  /** Called on error */
  onError?: (error: unknown) => void;
}
```

### createLocalServer

```typescript
interface LocalServerOptions {
  /** Port to listen on */
  port: number;

  /** Server secret for HMAC signing */
  secret: string;

  /** Base URL for generating public URLs */
  baseUrl: string;

  /** Routing mode: "wildcard" or "subpath" */
  mode?: "wildcard" | "subpath";

  /** Called when server starts */
  onReady?: (port: number) => void;

  /** Called when client connects */
  onClientConnect?: (id: string) => void;

  /** Called when client disconnects */
  onClientDisconnect?: (id: string) => void;
}
```

## License

MIT
