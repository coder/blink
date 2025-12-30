import { expect, test } from "bun:test";
import { serve } from "../../test";
import type { AgentLog } from "./logs.client";

test("get agent logs successfully", async () => {
  const mockLogs: AgentLog[] = [
    {
      timestamp: new Date("2024-01-01T10:00:00Z"),
      message: "Agent started",
      level: "info",
    },
    {
      timestamp: new Date("2024-01-01T10:05:00Z"),
      message: "Processing request",
      level: "info",
    },
  ];

  const { helpers } = await serve({
    bindings: {
      logs: {
        get: async (opts) => {
          expect(typeof opts.agent_id).toBe("string");
          expect(opts.start_time).toBeInstanceOf(Date);
          expect(opts.end_time).toBeInstanceOf(Date);
          expect(opts.limit).toBe(100);
          expect(opts.message_pattern).toBe("*info*");
          return mockLogs;
        },
      },
    },
  });

  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    name: "test-agent",
    organization_id: org.id,
  });

  const startTime = new Date("2024-01-01T09:00:00Z");
  const endTime = new Date("2024-01-01T11:00:00Z");

  const response = await client.agents.logs.logs({
    agent_id: agent.id,
    start_time: startTime,
    end_time: endTime,
    limit: 100,
    message_pattern: "*info*",
  });

  expect(response.logs).toHaveLength(2);
  expect(response.logs[0].message).toBe("Agent started");
  expect(response.logs[0].level).toBe("info");
  expect(response.logs[1].message).toBe("Processing request");
  expect(response.logs[1].level).toBe("info");
});

test("get agent logs without message pattern", async () => {
  const mockLogs: AgentLog[] = [
    {
      timestamp: new Date("2024-01-01T10:00:00Z"),
      message: "All logs",
      level: "info",
    },
  ];

  const { helpers } = await serve({
    bindings: {
      logs: {
        get: async (opts) => {
          expect(opts.message_pattern).toBeUndefined();
          return mockLogs;
        },
      },
    },
  });

  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    name: "test-agent",
    organization_id: org.id,
  });

  const response = await client.agents.logs.logs({
    agent_id: agent.id,
    start_time: new Date("2024-01-01T09:00:00Z"),
    end_time: new Date("2024-01-01T11:00:00Z"),
    limit: 200,
  });

  expect(response.logs).toHaveLength(1);
  expect(response.logs[0].message).toBe("All logs");
  expect(response.logs[0].level).toBe("info");
});

test("agent logs authorization failure", async () => {
  const { helpers } = await serve({
    bindings: {
      logs: {
        get: async () => {
          throw new Error("Should not reach logs service");
        },
      },
    },
  });

  const { client: ownerClient } = await helpers.createUser();
  const { client: otherClient } = await helpers.createUser();

  const org = await ownerClient.organizations.create({
    name: "private-org",
  });
  const agent = await ownerClient.agents.create({
    name: "private-agent",
    organization_id: org.id,
  });

  await expect(
    otherClient.agents.logs.logs({
      agent_id: agent.id,
      start_time: new Date("2024-01-01T09:00:00Z"),
      end_time: new Date("2024-01-01T11:00:00Z"),
      limit: 100,
    })
  ).rejects.toThrow("Organization not found");
});

test("agent logs with empty result", async () => {
  const { helpers } = await serve({
    bindings: {
      logs: {
        get: async () => [],
      },
    },
  });

  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    name: "test-agent",
    organization_id: org.id,
  });

  const response = await client.agents.logs.logs({
    agent_id: agent.id,
    start_time: new Date("2024-01-01T09:00:00Z"),
    end_time: new Date("2024-01-01T11:00:00Z"),
    limit: 100,
  });

  expect(response.logs).toEqual([]);
});

test("agent logs with invalid agent id", async () => {
  const { helpers } = await serve({
    bindings: {
      logs: {
        get: async () => {
          throw new Error("Should not reach logs service");
        },
      },
    },
  });

  const { client } = await helpers.createUser();

  await expect(
    client.agents.logs.logs({
      agent_id: "invalid-agent-id",
      start_time: new Date("2024-01-01T09:00:00Z"),
      end_time: new Date("2024-01-01T11:00:00Z"),
      limit: 100,
    })
  ).rejects.toThrow("Invalid agent ID");
});

test("agent logs parameter validation", async () => {
  const { helpers } = await serve({
    bindings: {
      logs: {
        get: async () => {
          throw new Error("Should not reach logs service");
        },
      },
    },
  });

  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    name: "test-agent",
    organization_id: org.id,
  });

  // Test limit out of range - too high
  await expect(
    client.agents.logs.logs({
      agent_id: agent.id,
      start_time: new Date("2024-01-01T09:00:00Z"),
      end_time: new Date("2024-01-01T11:00:00Z"),
      limit: 20000, // Above AWS limit of 10,000
    })
  ).rejects.toThrow();

  // Test limit out of range - too low
  await expect(
    client.agents.logs.logs({
      agent_id: agent.id,
      start_time: new Date("2024-01-01T09:00:00Z"),
      end_time: new Date("2024-01-01T11:00:00Z"),
      limit: 0, // Below minimum of 1
    })
  ).rejects.toThrow();
});

test("get agent logs without limit parameter (optional)", async () => {
  const mockLogs: AgentLog[] = [
    {
      timestamp: new Date("2024-01-01T10:00:00Z"),
      message: "Agent started",
      level: "info",
    },
    {
      timestamp: new Date("2024-01-01T10:05:00Z"),
      message: "Processing request",
      level: "info",
    },
  ];

  const { helpers } = await serve({
    bindings: {
      logs: {
        get: async (opts) => {
          expect(typeof opts.agent_id).toBe("string");
          expect(opts.start_time).toBeInstanceOf(Date);
          expect(opts.end_time).toBeInstanceOf(Date);
          // Verify that limit is either undefined or has a default value
          expect(
            opts.limit === undefined || typeof opts.limit === "number"
          ).toBe(true);
          return mockLogs;
        },
      },
    },
  });

  const { client } = await helpers.createUser();
  const org = await client.organizations.create({
    name: "test-org",
  });
  const agent = await client.agents.create({
    name: "test-agent",
    organization_id: org.id,
  });

  const startTime = new Date("2024-01-01T09:00:00Z");
  const endTime = new Date("2024-01-01T11:00:00Z");

  // Call API without limit parameter to test it's optional
  const response = await client.agents.logs.logs({
    agent_id: agent.id,
    start_time: startTime,
    end_time: endTime,
  });

  expect(response.logs).toHaveLength(2);
  expect(response.logs[0].message).toBe("Agent started");
  expect(response.logs[0].level).toBe("info");
  expect(response.logs[1].message).toBe("Processing request");
  expect(response.logs[1].level).toBe("info");
});

test("logs permissions - requires write permission", async () => {
  const { helpers, bindings } = await serve({
    bindings: {
      logs: {
        get: async () => [],
      },
    },
  });
  const { user: readUser, client: readClient } = await helpers.createUser();
  const { user: writeUser, client: writeClient } = await helpers.createUser();
  const { client: ownerClient } = await helpers.createUser();

  const org = await ownerClient.organizations.create({ name: "test-org" });
  const db = await bindings.database();
  await db.insertOrganizationMembership({
    organization_id: org.id,
    user_id: readUser.id,
    role: "member",
  });
  await db.insertOrganizationMembership({
    organization_id: org.id,
    user_id: writeUser.id,
    role: "member",
  });

  const agent = await ownerClient.agents.create({
    organization_id: org.id,
    name: "test-agent",
    visibility: "private",
  });

  await ownerClient.agents.members.grant({
    agent_id: agent.id,
    user_id: readUser.id,
    permission: "read",
  });
  await ownerClient.agents.members.grant({
    agent_id: agent.id,
    user_id: writeUser.id,
    permission: "write",
  });

  // Read user cannot access logs
  await expect(
    readClient.agents.logs.logs({
      agent_id: agent.id,
      start_time: new Date("2025-01-01"),
      end_time: new Date("2025-01-02"),
    })
  ).rejects.toThrow("requires write permission");

  // Write user can access logs
  const result = await writeClient.agents.logs.logs({
    agent_id: agent.id,
    start_time: new Date("2025-01-01"),
    end_time: new Date("2025-01-02"),
  });
  expect(result).toBeDefined();
  expect(result.logs).toBeDefined();
});
