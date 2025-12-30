import { createClient } from "@clickhouse/client-web";
import { readFileSync } from "fs";
import type { ClickHouseConfig } from "./types";

export const testConfig: ClickHouseConfig = {
  url: process.env.CLICKHOUSE_HOST || "http://localhost:8123",
  username: process.env.CLICKHOUSE_USERNAME || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "default",
  database: "", // Will be set per test
};

export const isClickHouseUnavailable = async () => {
  try {
    const response = await fetch(testConfig.url);
    // Cancel the response body to prevent stalled HTTP response warnings
    if (response.body) {
      await response.body.cancel();
    }
    // ClickHouse will return a 200 status code if it's running
    return !response.ok;
  } catch {
    return true;
  }
};

export function createTestDatabase(): string {
  return `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

export async function setupDatabase(
  dbName: string,
  migrationPath: string
): Promise<void> {
  const client = createClient({
    ...testConfig,
    database: "default", // Connect to default to create the test database
  });

  // Create test database
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${dbName}`,
  });

  // Switch to test database
  const testClient = createClient({
    ...testConfig,
    database: dbName,
  });

  // Read and execute migration
  const migrationSql = readFileSync(migrationPath, "utf-8");

  await testClient.command({
    query: migrationSql,
  });

  await testClient.close();
  await client.close();
}

export async function teardownDatabase(dbName: string): Promise<void> {
  const client = createClient({
    ...testConfig,
    database: "default",
  });

  await client.command({
    query: `DROP DATABASE IF EXISTS ${dbName}`,
  });

  await client.close();
}

export async function withTestDatabase<T>(
  migrationPath: string,
  testFn: (dbName: string, config: ClickHouseConfig) => Promise<T>
): Promise<T> {
  const dbName = createTestDatabase();
  const config = { ...testConfig, database: dbName };

  try {
    await setupDatabase(dbName, migrationPath);
    return await testFn(dbName, config);
  } finally {
    await teardownDatabase(dbName);
  }
}
