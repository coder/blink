import { expect, test } from "bun:test";
import { serve } from "../test";

test("webhook", async () => {
  let deployedPromise: Promise<void> | undefined;

  const { bindings, helpers, url } = await serve({
    bindings: {
      async deployAgent(deployment): Promise<void> {
        deployedPromise = (async () => {
          const srv = await Bun.serve({
            fetch: () => {
              return new Response("Hello, world!");
            },
            port: 0,
          });

          const db = await bindings.database();
          await db.updateAgentDeployment({
            id: deployment.id,
            agent_id: deployment.agent_id,
            status: "success",
            direct_access_url: srv.url.toString(),
          });
          await db.updateAgent({
            id: deployment.agent_id,
            active_deployment_id: deployment.id,
          });
        })();
      },
    },
  });

  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    organization_id: org.id,
    name: "test-agent",
    visibility: "public",

    output_files: [
      {
        path: "test.js",
        data: "console.log('Hello, world!');",
      },
    ],
  });
  await deployedPromise!;
  if (!agent.request_url) {
    throw new Error("No webhook route");
  }

  // Test the wildcard hostname routing (current implementation).
  // We need to make the request go through the test server with the correct Host header.
  const agentRequestURL = new URL(agent.request_url!);
  const response1 = await fetch(agentRequestURL);
  expect(response1.status).toBe(200);
  expect(await response1.text()).toBe("Hello, world!");
});
