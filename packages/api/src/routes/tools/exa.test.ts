import { afterEach, beforeEach, expect, test } from "bun:test";
import { http } from "msw";
import { setupServer, SetupServerApi } from "msw/node";
import Client from "../../client.browser";
import { serve } from "../../test";
import { generateAgentInvocationToken } from "../agents/me/me.server";

let requestURL: string | undefined;
let server: SetupServerApi;
beforeEach(() => {
  server = setupServer();
  server.use(
    http.post("https://api.exa.ai/search", ({ request }) => {
      requestURL = request.url;
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Test",
            },
          ],
        })
      );
    })
  );
  server.listen({
    onUnhandledRequest: "bypass",
  });
});
afterEach(() => {
  server.close();
});

test("unauthenticated", async () => {
  const { url } = await serve({
    bindings: {
      TOOLS_EXA_API_KEY: "test",
    },
  });

  let requestURL: string | undefined;
  const server = setupServer();
  server.use(
    http.post("https://api.exa.ai/search", ({ request }) => {
      requestURL = request.url;
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Test",
            },
          ],
        })
      );
    })
  );
  server.listen({
    onUnhandledRequest: "bypass",
  });

  const client = new Client({
    baseURL: url.toString(),
  });
  const resp = await client.request(
    "POST",
    "/api/tools/exa/search?some-query",
    JSON.stringify({
      query: "test",
    })
  );
  expect(resp.status).toBe(401);
});

test("authenticated", async () => {
  const { helpers } = await serve({
    bindings: {
      TOOLS_EXA_API_KEY: "test",
    },
  });

  let requestURL: string | undefined;
  const server = setupServer();
  server.use(
    http.post("https://api.exa.ai/search", ({ request }) => {
      requestURL = request.url;
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Test",
            },
          ],
        })
      );
    })
  );
  server.listen({
    onUnhandledRequest: "bypass",
  });

  const { client } = await helpers.createUser();
  const resp = await client.request(
    "POST",
    "/api/tools/exa/search?some-query",
    JSON.stringify({
      query: "test",
    })
  );
  expect(resp.status).toBe(200);
  expect(requestURL).toBe("https://api.exa.ai/search?some-query");
});

test("authenticated with x-api-key", async () => {
  const { helpers, bindings } = await serve({
    bindings: {
      TOOLS_EXA_API_KEY: "test",
    },
  });

  const { client, user } = await helpers.createUser();

  const agent = await client.agents.create({
    name: "test-agent",
    description: "Test Description",
    organization_id: user.organization_id,
  });

  const deployment = await client.agents.deployments.create({
    agent_id: agent.id,
    target: "production",
    output_files: [
      {
        path: "test.js",
        data: "console.log('Hello, world!');",
      },
    ],
  });

  const target = await (
    await bindings.database()
  ).selectAgentDeploymentTargetByName(agent.id, "production");
  if (!target) {
    throw new Error("Target not found");
  }
  const token = await generateAgentInvocationToken(bindings.AUTH_SECRET, {
    agent_id: agent.id,
    agent_deployment_id: deployment.id,
    agent_deployment_target_id: target.id,
  });
  const resp = await client.request(
    "POST",
    "/api/tools/exa/search?some-query",
    JSON.stringify({
      query: "test",
    }),
    {
      headers: {
        "x-api-key": token,
      },
    }
  );
  expect(resp.status).toBe(200);
  expect(requestURL).toBe("https://api.exa.ai/search?some-query");
});
