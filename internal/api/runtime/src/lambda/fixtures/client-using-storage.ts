import { APIServerURLEnvironmentVariable } from "blink/client";
import { api } from "blink/control";
import { hc } from "hono/client";
import http from "http";

// Here we're going to make it actually attempt to request the Blink API.
const client = hc<typeof api>(process.env[APIServerURLEnvironmentVariable]!);

http
  .createServer(async (req, res) => {
    await client.kv[":key"].$post({
      param: {
        key: "test",
      },
      json: {
        value: "Hello, world!",
      },
    });

    const resp = await client.kv[":key"].$get({
      param: {
        key: "test",
      },
    });
    if (!resp.ok) {
      throw new Error(`Failed to get storage: ${await resp.text()}`);
    }
    const value = await resp.json();
    res.end(value.value);
  })
  .listen(parseInt(process.env.PORT as string))
  .unref();
