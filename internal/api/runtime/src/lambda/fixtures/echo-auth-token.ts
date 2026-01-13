import { getAuthToken, runWithAuth } from "blink/internal";
import http from "http";

// Header name for internal auth - must match the value in server.ts
const InternalAuthHeader = "x-blink-internal-auth";

http
  .createServer(async (req, res) => {
    // Read auth token from request header (set by the wrapper's proxy)
    // and set up AsyncLocalStorage context.
    const authToken = req.headers[InternalAuthHeader] as string;

    await runWithAuth(authToken ?? "", async () => {
      // Simulate some async work to test context isolation
      await new Promise((r) => setTimeout(r, Math.random() * 50));

      // Return the auth token we see in this context
      const token = getAuthToken();
      res.end(token ?? "NO_TOKEN");
    });
  })
  .listen(parseInt(process.env.PORT as string))
  .unref();
