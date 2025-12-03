# Coder Compute Provider

This compute provider allows the Scout agent to use [Coder](https://coder.com) workspaces for code execution.

## Prerequisites

1. A running Coder deployment
2. A valid session token for authentication
3. A template configured for workspace creation (if creating new workspaces)
4. The template should have Node.js installed (required for the blink compute server)

## How It Works

This provider uses the Coder HTTP API directly via `fetch` calls - no CLI required. It:

1. **Authenticates** using a session token via the `Coder-Session-Token` HTTP header
2. **Creates/manages workspaces** via REST API calls to `/api/v2/...`
3. **Executes commands** via WebSocket connection to the reconnecting PTY endpoint
4. **Connects to compute server** by tunneling through the PTY via netcat

## Configuration

```typescript
import { Scout } from "@blink-sdk/scout-agent";

const scout = new Scout({
  agent,
  compute: {
    type: "coder",
    options: {
      // Required: Your Coder deployment URL
      url: "https://coder.example.com",

      // Required: Session token for authentication
      // Can be obtained from `coder tokens create` or the Coder UI
      sessionToken: process.env.CODER_SESSION_TOKEN,

      // Optional: Port for the blink compute server (default: 22137)
      computeServerPort: 22137,

      // Optional: Template to create workspaces from
      // Required if you want to create new workspaces
      template: "my-dev-template",

      // Optional: Specific workspace name
      // If not provided, a unique name will be generated
      workspaceName: "my-workspace",

      // Optional: Agent name (if workspace has multiple agents)
      agentName: "main",

      // Optional: Template parameters for workspace creation
      richParameters: [
        { name: "cpu", value: "4" },
        { name: "memory", value: "8" },
      ],

      // Optional: Timeout for workspace startup (default: 300 seconds)
      startTimeoutSeconds: 300,
    },
  },
});
```

## API Endpoints Used

| Endpoint | Purpose |
|----------|--------|
| `GET /api/v2/users/me` | Get current user |
| `GET /api/v2/users/{owner}/workspace/{name}` | Get workspace by owner and name |
| `GET /api/v2/workspaces/{id}` | Get workspace by ID |
| `GET /api/v2/organizations/default` | Get default organization |
| `GET /api/v2/organizations/{org}/templates/{name}` | Get template by name |
| `POST /api/v2/organizations/{org}/members/me/workspaces` | Create workspace |
| `POST /api/v2/workspaces/{id}/builds` | Start/stop workspace |
| `WS /api/v2/workspaceagents/{id}/pty` | Execute commands & tunnel traffic |

## Workflow

### Initialization

When `initialize_workspace` is called:

1. Checks if an existing workspace is stored and reusable
2. If workspace is stopped, starts it via the API
3. Waits for workspace and agent to be ready
4. Executes the blink compute server installation script via PTY
5. Waits for the compute server to start

### Connection

When executing tools:

1. Verifies workspace is running and agent is connected
2. Opens WebSocket to PTY endpoint with `nc 127.0.0.1 {port}` command
3. This creates a tunnel: WebSocket ↔ PTY ↔ netcat ↔ TCP compute server
4. The compute protocol communicates through this tunnel

## Requirements for Templates

Your Coder template should have:

1. **Node.js installed**: The blink compute server requires Node.js (v18+)
2. **netcat (nc) installed**: Used to tunnel traffic to the compute server
3. **Network access**: The workspace needs to be able to install npm packages

Example minimal template requirements:
```hcl
resource "coder_agent" "main" {
  # ...
  startup_script = <<-EOF
    # Ensure node and netcat are available
    sudo apt-get update
    sudo apt-get install -y nodejs npm netcat-openbsd
  EOF
}
```

## Environment Variables

You can use environment variables for configuration:

| Variable | Description |
|----------|-------------|
| `CODER_URL` | Coder deployment URL |
| `CODER_SESSION_TOKEN` | Session token for authentication |

## Getting a Session Token

### Via CLI
```bash
coder tokens create
```

### Via UI
1. Log into your Coder deployment
2. Go to Account Settings → Tokens
3. Create a new token with appropriate permissions

## Troubleshooting

### "HTTP 401: Unauthorized"

Your session token is invalid or expired. Create a new one.

### "Template not found"

The template name doesn't exist in the default organization. Check:
- The template name is spelled correctly
- You have permission to use the template
- The template is in the default organization

### "Timeout waiting for workspace to be ready"

Your workspace may be taking longer than expected to start. Try:
- Increasing `startTimeoutSeconds`
- Checking the workspace logs in the Coder UI
- Ensuring your template provisions resources quickly

### "Agent not connected"

The workspace agent may be having issues. Check:
- The agent logs in the Coder UI
- Network connectivity from the workspace
- The agent startup script

### "Failed to connect to compute server"

The blink compute server may not be running. Check:
- `/tmp/blink-compute.log` inside the workspace for errors
- Node.js is installed and accessible
- The specified port is not blocked
- netcat (nc) is installed in the workspace

### Connection drops or hangs

The PTY-based tunnel may have issues with binary data. Ensure:
- The workspace has `netcat-openbsd` installed (not `netcat-traditional`)
- The compute server port is correct
