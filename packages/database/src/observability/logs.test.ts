import { describe, expect, test } from "bun:test";
import connectToPostgres from "../postgres";
import Querier from "../querier";
import { createPostgresURL, createTestAgent } from "../test";
import { getAgentLogs, regexFromText, writeAgentLog } from "./logs";

describe("regexFromText", () => {
  test("simple text without special characters", () => {
    expect(regexFromText("hello")).toBe("hello");
    expect(regexFromText("test message")).toBe("test message");
  });

  test("wildcard asterisks become .*", () => {
    expect(regexFromText("hello*world")).toBe("hello.*world");
    expect(regexFromText("*start")).toBe(".*start");
    expect(regexFromText("end*")).toBe("end.*");
    expect(regexFromText("*")).toBe(".*");
  });

  test("regex metacharacters are escaped", () => {
    expect(regexFromText("hello.world")).toBe("hello\\.world");
    expect(regexFromText("test[abc]")).toBe("test\\[abc\\]");
    expect(regexFromText("query?param=value")).toBe("query\\?param=value");
  });

  test("complex patterns with wildcards", () => {
    expect(regexFromText("*.log")).toBe(".*\\.log");
    expect(regexFromText("error[*]")).toBe("error\\[.*\\]");
  });
});

describe("Agent Logs", () => {
  test("should insert and retrieve logs", async () => {
    const url = await createPostgresURL();
    const db = await connectToPostgres(url);
    const querier = new Querier(db);
    const agent = await createTestAgent(querier);

    // Insert test log
    await writeAgentLog(db, {
      agent_id: agent.id,
      event: {
        message: "Test log message",
        level: "info",
        source: "test",
      },
    });

    const start = new Date(Date.now() - 1000 * 60); // 1 minute ago
    const end = new Date(Date.now() + 1000 * 60); // 1 minute from now

    // Query logs
    const logs = await getAgentLogs(db, {
      agent_id: agent.id,
      start_time: start,
      end_time: end,
      limit: 100,
    });

    expect(logs).toHaveLength(1);
    const log = logs[0];
    if (!log) {
      throw new Error("No log found");
    }
    expect(log.message).toContain("Test log message");
    expect(log.level).toBe("info");
    expect(Math.abs(start.getTime() - log.timestamp.getTime())).toBeLessThan(
      90 * 1000
    );
  });

  test("should filter logs by message_pattern", async () => {
    const url = await createPostgresURL();
    const db = await connectToPostgres(url);
    const querier = new Querier(db);
    const agent = await createTestAgent(querier);

    // Insert multiple logs
    await writeAgentLog(db, {
      agent_id: agent.id,
      event: { message: "error occurred in system", level: "error" },
    });
    await writeAgentLog(db, {
      agent_id: agent.id,
      event: { message: "info about deployment", level: "info" },
    });
    await writeAgentLog(db, {
      agent_id: agent.id,
      event: { message: "another error happened", level: "error" },
    });

    // Query with message_pattern
    const logs = await getAgentLogs(db, {
      agent_id: agent.id,
      message_pattern: "*error*",
      start_time: new Date(Date.now() - 1000 * 60),
      end_time: new Date(Date.now() + 1000 * 60),
      limit: 100,
    });

    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.message.toLowerCase()).toContain("error");
    }
  });

  test("should filter logs by advanced filters", async () => {
    const url = await createPostgresURL();
    const db = await connectToPostgres(url);
    const querier = new Querier(db);
    const agent = await createTestAgent(querier);

    // Insert logs with different sources
    await writeAgentLog(db, {
      agent_id: agent.id,
      event: { message: "log from app", source: "application" },
    });
    await writeAgentLog(db, {
      agent_id: agent.id,
      event: { message: "log from system", source: "system" },
    });

    // Query with advanced filters
    const logs = await getAgentLogs(db, {
      agent_id: agent.id,
      filters: {
        type: "and",
        filters: [{ type: "eq", key: "source", value: "application" }],
      },
      start_time: new Date(Date.now() - 1000 * 60),
      end_time: new Date(Date.now() + 1000 * 60),
      limit: 100,
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.message).toContain("app");
  });
});
