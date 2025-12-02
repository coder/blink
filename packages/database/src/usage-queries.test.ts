import { beforeEach, describe, expect, test } from "bun:test";
import type { PgInsertValue, PgTable } from "drizzle-orm/pg-core";
import connectToPostgres from "./postgres";
import Querier from "./querier";
import {
  createPostgresURL,
  createTestAgent,
  createTestAgentDeployment,
  createTestChat,
  createTestOrganization,
  createTestUser,
} from "./test";

type Insertable<T extends PgTable, K extends keyof PgInsertValue<T> = never> = {
  [P in keyof PgInsertValue<T> as P extends K ? never : P]: PgInsertValue<T>[P];
} & {
  [P in keyof PgInsertValue<T> as P extends K ? P : never]?:
    | PgInsertValue<T>[P]
    | undefined;
};

describe("Agent Usage Queries", () => {
  let querier: Querier;
  let userId: string;
  let orgId: string;
  let agentId: string;
  let deploymentId: string;
  let chatId: string;

  beforeEach(async () => {
    const url = await createPostgresURL();
    querier = new Querier(await connectToPostgres(url));

    const user = await createTestUser(querier);
    userId = user.id;

    const org = await createTestOrganization(querier, { created_by: userId });
    orgId = org.id;

    const agent = await createTestAgent(querier, {
      created_by: userId,
      organization_id: orgId,
    });
    agentId = agent.id;

    const deployment = await createTestAgentDeployment(querier, {
      agent_id: agentId,
      created_by: userId,
    });
    deploymentId = deployment.id;

    const chat = await createTestChat(querier, {
      agent_id: agentId,
      created_by: userId,
      organization_id: orgId,
    });
    chatId = chat.id;
  });

  async function createChatRunStep(options: {
    startedAt: Date;
    completedAt?: Date;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    model?: string;
    ttftMicros?: number;
  }) {
    // Use reconcileChatRun to create the chat run and first step
    await querier.reconcileChatRun({
      behavior: "interrupt",
      chat_id: chatId,
      agent_id: agentId,
      agent_deployment_id: deploymentId,
    });

    // Get the latest run to get the run ID
    const run = await querier.selectLatestChatRun(chatId);
    if (!run) {
      throw new Error("Failed to create chat run");
    }

    // Get the created step
    const steps = await querier.selectChatSteps({
      chat_id: chatId,
      limit: 1,
    });
    if (!steps.items || steps.items.length === 0) {
      throw new Error("Failed to get chat run step");
    }
    const latestStep = steps.items[0];

    // Update the step with our custom values
    await querier.updateChatRunStep({
      id: latestStep.id,
      started_at: options.startedAt,
      completed_at: options.completedAt,
      usage_total_input_tokens: options.inputTokens,
      usage_total_output_tokens: options.outputTokens,
      usage_total_cached_input_tokens: options.cachedTokens,
      usage_model: options.model,
      time_to_first_token_micros: options.ttftMicros,
    });

    return latestStep;
  }

  test("selectAgentTokenUsageStats returns correct totals", async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 20,
      model: "gpt-4",
      ttftMicros: 100000,
    });

    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 200,
      outputTokens: 100,
      cachedTokens: 30,
      model: "gpt-4",
      ttftMicros: 150000,
    });

    const stats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate: new Date(oneDayAgo.getTime() - 1000),
      endDate: new Date(now.getTime() + 1000),
    });

    expect(stats.total_input_tokens).toBe(300);
    expect(stats.total_output_tokens).toBe(150);
    expect(stats.total_cached_tokens).toBe(50);
    expect(stats.avg_ttft_ms).toBe(125);
    expect(stats.models).toContain("gpt-4");
  });

  test("selectAgentTokenUsageStats filters by date range correctly", async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    // Step from 2 days ago (should be excluded)
    await createChatRunStep({
      startedAt: twoDaysAgo,
      completedAt: twoDaysAgo,
      inputTokens: 1000,
      outputTokens: 1000,
      cachedTokens: 1000,
      model: "gpt-4",
    });

    // Step from 1 day ago (should be included)
    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 20,
      model: "gpt-4",
    });

    const stats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate: oneDayAgo,
      endDate: now,
    });

    expect(stats.total_input_tokens).toBe(100);
    expect(stats.total_output_tokens).toBe(50);
    expect(stats.total_cached_tokens).toBe(20);
  });

  test("selectAgentChatsWithGranularity counts unique chats", async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Create 3 steps for the same chat
    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    // Create a different chat
    const chat2 = await createTestChat(querier, {
      agent_id: agentId,
      created_by: userId,
      organization_id: orgId,
    });
    const oldChatId = chatId;
    chatId = chat2.id;

    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    chatId = oldChatId;

    const chats = await querier.selectAgentChatsWithGranularity({
      agentID: agentId,
      startDate: new Date(oneDayAgo.getTime() - 1000),
      endDate: new Date(now.getTime() + 1000),
      granularity: "1 day",
    });

    expect(chats.length).toBeGreaterThan(0);
    const totalUniqueChats = chats.reduce((sum, c) => sum + c.unique_chats, 0);
    expect(totalUniqueChats).toBe(2);
  });

  test("selectAgentRuntimeWithGranularity calculates runtime correctly", async () => {
    const now = new Date();
    const startTime = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    const endTime = new Date(now.getTime() - 30 * 60 * 1000); // 30 minutes ago

    await createChatRunStep({
      startedAt: startTime,
      completedAt: endTime,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    const runtime = await querier.selectAgentRuntimeWithGranularity({
      agentID: agentId,
      startDate: new Date(startTime.getTime() - 1000),
      endDate: new Date(now.getTime() + 1000),
      granularity: "1 hour",
    });

    expect(runtime.length).toBeGreaterThan(0);
    const totalRuntime = runtime.reduce((sum, r) => sum + r.runtime_seconds, 0);
    // Should be approximately 30 minutes (1800 seconds)
    expect(totalRuntime).toBeGreaterThan(1700);
    expect(totalRuntime).toBeLessThan(1900);
  });

  test("selectAgentTokenUsageByModelWithGranularity aggregates by model", async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 10,
      model: "gpt-4",
    });

    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 200,
      outputTokens: 100,
      cachedTokens: 20,
      model: "gpt-3.5-turbo",
    });

    const usage = await querier.selectAgentTokenUsageByModelWithGranularity({
      agentID: agentId,
      startDate: new Date(oneDayAgo.getTime() - 1000),
      endDate: new Date(now.getTime() + 1000),
      granularity: "1 day",
    });

    expect(usage.length).toBe(2);

    const gpt4Usage = usage.find((u) => u.model === "gpt-4");
    expect(gpt4Usage).toBeDefined();
    expect(gpt4Usage!.input_tokens).toBe(100);
    expect(gpt4Usage!.output_tokens).toBe(50);
    expect(gpt4Usage!.cached_tokens).toBe(10);

    const gpt35Usage = usage.find((u) => u.model === "gpt-3.5-turbo");
    expect(gpt35Usage).toBeDefined();
    expect(gpt35Usage!.input_tokens).toBe(200);
    expect(gpt35Usage!.output_tokens).toBe(100);
    expect(gpt35Usage!.cached_tokens).toBe(20);
  });

  test("selectAgentTTFTByModelWithGranularity calculates average TTFT", async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
      ttftMicros: 100000, // 100ms
    });

    await createChatRunStep({
      startedAt: oneDayAgo,
      completedAt: now,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
      ttftMicros: 200000, // 200ms
    });

    const ttft = await querier.selectAgentTTFTByModelWithGranularity({
      agentID: agentId,
      startDate: new Date(oneDayAgo.getTime() - 1000),
      endDate: new Date(now.getTime() + 1000),
      granularity: "1 day",
    });

    expect(ttft.length).toBe(1);
    expect(ttft[0].model).toBe("gpt-4");
    expect(ttft[0].avg_ttft_ms).toBe(150);
  });

  test("24h granularity with hourly buckets", async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Create steps in different hours
    const hour1 = new Date(oneDayAgo.getTime() + 60 * 60 * 1000);
    const hour2 = new Date(oneDayAgo.getTime() + 2 * 60 * 60 * 1000);

    await createChatRunStep({
      startedAt: hour1,
      completedAt: hour1,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    await createChatRunStep({
      startedAt: hour2,
      completedAt: hour2,
      inputTokens: 200,
      outputTokens: 100,
      model: "gpt-4",
    });

    const usage = await querier.selectAgentTokenUsageByModelWithGranularity({
      agentID: agentId,
      startDate: oneDayAgo,
      endDate: now,
      granularity: "1 hour",
    });

    expect(usage.length).toBe(2);
  });

  test("30d granularity with daily buckets", async () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Create steps on different days
    const day1 = new Date(thirtyDaysAgo.getTime() + 24 * 60 * 60 * 1000);
    const day2 = new Date(thirtyDaysAgo.getTime() + 2 * 24 * 60 * 60 * 1000);

    await createChatRunStep({
      startedAt: day1,
      completedAt: day1,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    await createChatRunStep({
      startedAt: day2,
      completedAt: day2,
      inputTokens: 200,
      outputTokens: 100,
      model: "gpt-4",
    });

    const usage = await querier.selectAgentTokenUsageByModelWithGranularity({
      agentID: agentId,
      startDate: thirtyDaysAgo,
      endDate: now,
      granularity: "1 day",
    });

    expect(usage.length).toBe(2);
  });

  test("page simulation: 24h range with real date calculation", async () => {
    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - 1);

    // Create a step that's exactly 12 hours ago
    const twelveHoursAgo = new Date(endTime.getTime() - 12 * 60 * 60 * 1000);

    await createChatRunStep({
      startedAt: twelveHoursAgo,
      completedAt: twelveHoursAgo,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    // This should find the step
    const tokenStats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate: startTime,
      endDate: endTime,
    });

    expect(tokenStats.total_input_tokens).toBe(100);
    expect(tokenStats.total_output_tokens).toBe(50);
  });

  test("page simulation: 30d range with day boundary normalization", async () => {
    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - 30);

    // Normalize to day boundaries like the page does
    startTime.setHours(0, 0, 0, 0);
    endTime.setHours(23, 59, 59, 999);

    // Create a step at the very start of today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 1);

    await createChatRunStep({
      startedAt: todayStart,
      completedAt: todayStart,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    // Create a step at the very end of today
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 0);

    await createChatRunStep({
      startedAt: todayEnd,
      completedAt: todayEnd,
      inputTokens: 200,
      outputTokens: 100,
      model: "gpt-4",
    });

    // Both should be included
    const tokenStats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate: startTime,
      endDate: endTime,
    });

    expect(tokenStats.total_input_tokens).toBe(300);
    expect(tokenStats.total_output_tokens).toBe(150);
  });

  test("edge case: step started exactly at startDate boundary", async () => {
    const startDate = new Date("2025-01-01T00:00:00.000Z");
    const endDate = new Date("2025-01-02T23:59:59.999Z");

    await createChatRunStep({
      startedAt: new Date("2025-01-01T00:00:00.000Z"),
      completedAt: new Date("2025-01-01T00:00:00.100Z"),
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    const tokenStats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate,
      endDate,
    });

    expect(tokenStats.total_input_tokens).toBe(100);
  });

  test("edge case: step started exactly at endDate boundary", async () => {
    const startDate = new Date("2025-01-01T00:00:00.000Z");
    const endDate = new Date("2025-01-02T23:59:59.999Z");

    await createChatRunStep({
      startedAt: new Date("2025-01-02T23:59:59.999Z"),
      completedAt: new Date("2025-01-02T23:59:59.999Z"),
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    const tokenStats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate,
      endDate,
    });

    expect(tokenStats.total_input_tokens).toBe(100);
  });

  test("edge case: step started 1ms before startDate should be excluded", async () => {
    const startDate = new Date("2025-01-01T00:00:00.000Z");
    const endDate = new Date("2025-01-02T23:59:59.999Z");

    await createChatRunStep({
      startedAt: new Date("2024-12-31T23:59:59.999Z"),
      completedAt: new Date("2025-01-01T00:00:00.100Z"),
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    const tokenStats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate,
      endDate,
    });

    expect(tokenStats.total_input_tokens).toBe(0);
  });

  test("edge case: step started 1ms after endDate should be excluded", async () => {
    const startDate = new Date("2025-01-01T00:00:00.000Z");
    const endDate = new Date("2025-01-02T23:59:59.999Z");

    await createChatRunStep({
      startedAt: new Date("2025-01-03T00:00:00.000Z"),
      completedAt: new Date("2025-01-03T00:00:00.100Z"),
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    const tokenStats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate,
      endDate,
    });

    expect(tokenStats.total_input_tokens).toBe(0);
  });

  test("reproduce issue: exact date calculation from page logic", async () => {
    // Simulate the exact logic from page.tsx
    function getTimeRangeConfig(range: "24h" | "7d" | "30d"): {
      days: number;
      granularity: "1 hour" | "1 day";
    } {
      switch (range) {
        case "24h":
          return { days: 1, granularity: "1 hour" };
        case "7d":
          return { days: 7, granularity: "1 hour" };
        case "30d":
          return { days: 30, granularity: "1 day" };
      }
    }

    // Test 30d range
    const range = "30d";
    const { days, granularity } = getTimeRangeConfig(range);

    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - days);

    if (granularity === "1 day") {
      startTime.setHours(0, 0, 0, 0);
      endTime.setHours(23, 59, 59, 999);
    }

    // Insert data 15 days ago
    const fifteenDaysAgo = new Date(
      endTime.getTime() - 15 * 24 * 60 * 60 * 1000
    );
    fifteenDaysAgo.setHours(12, 0, 0, 0);

    await createChatRunStep({
      startedAt: fifteenDaysAgo,
      completedAt: fifteenDaysAgo,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    const stats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate: startTime,
      endDate: endTime,
    });

    // This data should definitely be included
    expect(stats.total_input_tokens).toBe(100);
    expect(stats.total_output_tokens).toBe(50);
  });

  test("timezone issue: local time normalization may not match database timezone", async () => {
    // This test demonstrates a potential timezone issue
    // The page does: endTime.setHours(23, 59, 59, 999)
    // But this creates a local time, which when passed to Postgres
    // might be interpreted differently depending on timezone settings

    const endTime = new Date();
    const startTime = new Date();
    startTime.setDate(startTime.getDate() - 30);

    startTime.setHours(0, 0, 0, 0);
    endTime.setHours(23, 59, 59, 999);

    console.log("Start time (local):", startTime.toISOString());
    console.log("End time (local):", endTime.toISOString());
    console.log("Start time (string):", startTime.toString());
    console.log("End time (string):", endTime.toString());

    // Create a step that should be included
    const midDay = new Date();
    midDay.setHours(12, 0, 0, 0);

    await createChatRunStep({
      startedAt: midDay,
      completedAt: midDay,
      inputTokens: 100,
      outputTokens: 50,
      model: "gpt-4",
    });

    const stats = await querier.selectAgentTokenUsageStats({
      agentID: agentId,
      startDate: startTime,
      endDate: endTime,
    });

    // This should work, but let's verify the actual behavior
    expect(stats.total_input_tokens).toBe(100);
  });
});
