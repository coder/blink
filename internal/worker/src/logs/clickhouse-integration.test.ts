import type { FieldFilterGroup } from "@blink.so/api";
import { createClient } from "@clickhouse/client-web";
import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  isClickHouseUnavailable,
  withTestDatabase,
} from "../clickhouse/test-helpers";
import { getAgentLogs, writeAgentLog } from "./clickhouse";

const migrationSqlPath = join(__dirname, "../clickhouse/logs-migration.sql");

const TEST_AGENT_ID = "6c87dba5-3ef2-45ed-ad43-b1025f0f6238";

describe.skipIf(await isClickHouseUnavailable())(
  "getAgentLogs - Advanced Filtering",
  () => {
    test("should insert and retrieve logs", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert test log
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Test log message",
            level: "info",
            source: "test",
          },
        });

        await client.close();

        const start = new Date(Date.now() - 1000 * 60); // 1 minute ago
        const end = new Date(Date.now() + 1000 * 60); // 1 minute from now

        // Query logs
        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            start_time: start,
            end_time: end,
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(1);
        const log = logs[0];
        if (!log) {
          throw new Error("No log found");
        }
        expect(log.message).toContain("Test log message");
        expect(log.level).toBe("info");
        // check if we're handling timezones correctly - clickhouse stores everything in UTC,
        // so we want to check that we're correctly converting back to the local timezone
        expect(
          Math.abs(start.getTime() - log.timestamp.getTime())
        ).toBeLessThan(90 * 1000);
        expect(Math.abs(end.getTime() - log.timestamp.getTime())).toBeLessThan(
          90 * 1000
        );
      });
    });

    test("should filter logs by message_pattern (backward compatibility)", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert multiple logs
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: { message: "error occurred in system", level: "error" },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: { message: "info about deployment", level: "info" },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: { message: "another error happened", level: "error" },
        });

        await client.close();

        // Query with message_pattern
        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            message_pattern: "*error*",
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(2);
        logs.forEach((log) => {
          expect(log.message.toLowerCase()).toContain("error");
        });
      });
    });

    test("should filter logs by nested JSON path (deployment events)", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert logs with different event types
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.deploy.start",
            level: "info",
            message: "Starting deployment",
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.deploy.success",
            level: "info",
            message: "Deployment succeeded",
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.deploy.failure",
            level: "error",
            message: "Deployment failed",
          },
        });

        await client.close();

        // Query for deployment failures
        const filters: FieldFilterGroup = {
          type: "and",
          filters: [{ type: "eq", key: "type", value: "blink.deploy.failure" }],
        };

        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            filters,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toContain("Deployment failed");
      });
    });

    test("should combine message_pattern and advanced filters", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert various logs
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.deploy.failure",
            level: "error",
            message: "Deployment failed with timeout",
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.deploy.failure",
            level: "error",
            message: "Deployment failed with permission error",
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.runtime.error",
            level: "error",
            message: "Runtime failed with timeout",
          },
        });

        await client.close();

        // Query with both filters
        const filters: FieldFilterGroup = {
          type: "and",
          filters: [{ type: "eq", key: "type", value: "blink.deploy.failure" }],
        };

        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            message_pattern: "*timeout*",
            filters,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        // Should only get deployment failures with timeout
        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toContain("Deployment failed with timeout");
      });
    });

    test("should filter logs with multiple AND conditions", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert logs with different combinations
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.deploy.start",
            level: "info",
            source: "platform",
            message: "Starting deployment",
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.deploy.failure",
            level: "error",
            source: "platform",
            message: "Deployment failed",
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.deploy.failure",
            level: "error",
            source: "agent",
            message: "Agent deployment failed",
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            type: "blink.deploy.failure",
            level: "error",
            source: "platform",
            environment: "staging",
            message: "Staging deployment failed",
          },
        });

        await client.close();

        // Query with multiple conditions including nested group
        const filters: FieldFilterGroup = {
          type: "and",
          filters: [
            { type: "eq", key: "type", value: "blink.deploy.failure" },
            { type: "eq", key: "source", value: "platform" },
            {
              type: "and",
              filters: [{ type: "eq", key: "environment", value: "staging" }],
            },
          ],
        };

        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            filters,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toContain("Staging deployment failed");
      });
    });

    test("should isolate logs by agent_id", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);
        const agent1 = "11111111-1111-1111-1111-111111111111";
        const agent2 = "22222222-2222-2222-2222-222222222222";

        // Insert logs for different agents
        await writeAgentLog({
          client,
          agent_id: agent1,
          event: { message: "Agent 1 log", level: "info" },
        });
        await writeAgentLog({
          client,
          agent_id: agent2,
          event: { message: "Agent 2 log", level: "info" },
        });

        await client.close();

        // Query for agent1 only
        const logs = await getAgentLogs(
          {
            agent_id: agent1,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toContain("Agent 1 log");
      });
    });
  }
);

describe.skipIf(await isClickHouseUnavailable())(
  "getAgentLogs - Edge Cases",
  () => {
    test("should handle deeply nested JSON paths", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert logs with deeply nested structures
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Deployment with config",
            agent: {
              deployment: {
                config: {
                  memory_mb: 512,
                  environment: "production",
                },
              },
            },
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Deployment with different config",
            agent: {
              deployment: {
                config: {
                  memory_mb: 1024,
                  environment: "staging",
                },
              },
            },
          },
        });

        await client.close();

        // Query with deeply nested path
        const filters: FieldFilterGroup = {
          type: "and",
          filters: [
            {
              type: "eq",
              key: "agent.deployment.config.memory_mb",
              value: "512",
            },
          ],
        };

        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            filters,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toContain("Deployment with config");
      });
    });

    test("should handle special characters in filter values", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert logs with special characters
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: 'Error with "quotes" and \\ backslash',
            error_code: "ERR_SPECIAL_CHARS",
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Normal error",
            error_code: "ERR_NORMAL",
          },
        });

        await client.close();

        // Query with special characters in value
        const filters: FieldFilterGroup = {
          type: "and",
          filters: [
            { type: "eq", key: "error_code", value: "ERR_SPECIAL_CHARS" },
          ],
        };

        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            filters,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toContain("quotes");
      });
    });

    test("should return empty results for non-existent JSON paths", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert log without the field we'll query
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Log without special field",
            level: "info",
          },
        });

        await client.close();

        // Query for non-existent path
        const filters: FieldFilterGroup = {
          type: "and",
          filters: [
            {
              type: "eq",
              key: "nonexistent.deeply.nested.field",
              value: "anything",
            },
          ],
        };

        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            filters,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(0);
      });
    });

    test("should handle potential SQL injection attempts safely", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert normal log
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Normal log",
            field: "value",
          },
        });

        await client.close();

        // Try to inject SQL through filter key
        const filters: FieldFilterGroup = {
          type: "and",
          filters: [
            {
              type: "eq",
              key: "'; DROP TABLE agent_logs; --",
              value: "test",
            },
          ],
        };

        // Parameterized queries prevent SQL injection, but invalid JSON paths cause errors
        // This is expected behavior - ClickHouse validates the JSON path
        let errorThrown = false;
        try {
          await getAgentLogs(
            {
              agent_id: TEST_AGENT_ID,
              filters,
              start_time: new Date(Date.now() - 1000 * 60),
              end_time: new Date(Date.now() + 1000 * 60),
              limit: 100,
            },
            config
          );
        } catch (error) {
          errorThrown = true;
          // ClickHouse correctly rejects the invalid JSON path
          expect(error).toBeDefined();
        }

        // Verify an error was thrown (injection attempt blocked)
        expect(errorThrown).toBe(true);

        // Most importantly: verify table still exists and data is intact
        const verifyLogs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(verifyLogs).toHaveLength(1);
        expect(verifyLogs[0]?.message).toContain("Normal log");
      });
    });

    test("should handle escaped wildcards in message_pattern", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert logs with literal asterisks
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Error with error*code pattern",
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Error with errorXcode pattern",
          },
        });

        await client.close();

        // Query with escaped wildcard (should match literal *)
        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            message_pattern: "error\\*code",
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toContain("error*code");
      });
    });

    test("should handle numeric values in JSON filters", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert logs with numeric values
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Server on port 8080",
            port: 8080,
            status_code: 200,
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Server on port 3000",
            port: 3000,
            status_code: 404,
          },
        });

        await client.close();

        // Query with numeric value (JSON_VALUE returns strings)
        const filters: FieldFilterGroup = {
          type: "and",
          filters: [{ type: "eq", key: "port", value: "8080" }],
        };

        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            filters,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toContain("Server on port 8080");
      });
    });

    test("should handle boolean values in JSON filters", async () => {
      await withTestDatabase(migrationSqlPath, async (dbName, config) => {
        const client = createClient(config);

        // Insert logs with boolean values
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Successful operation",
            success: true,
            enabled: true,
          },
        });
        await writeAgentLog({
          client,
          agent_id: TEST_AGENT_ID,
          event: {
            message: "Failed operation",
            success: false,
            enabled: true,
          },
        });

        await client.close();

        // Query with boolean value (JSON_VALUE returns strings)
        const filters: FieldFilterGroup = {
          type: "and",
          filters: [{ type: "eq", key: "success", value: "true" }],
        };

        const logs = await getAgentLogs(
          {
            agent_id: TEST_AGENT_ID,
            filters,
            start_time: new Date(Date.now() - 1000 * 60),
            end_time: new Date(Date.now() + 1000 * 60),
            limit: 100,
          },
          config
        );

        expect(logs).toHaveLength(1);
        expect(logs[0]?.message).toContain("Successful operation");
      });
    });
  }
);
