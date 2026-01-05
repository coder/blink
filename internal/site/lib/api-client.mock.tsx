import Client from "@blink.so/api";
import type { StoryFn } from "@storybook/react";
import { fn } from "storybook/test";

// Type-safe mock function that preserves the original function's types
// biome-ignore lint/suspicious/noExplicitAny: generic function type
type TypedMockFn<T extends (...args: any[]) => any> = T & {
  mockResolvedValue: (value: Awaited<ReturnType<T>>) => TypedMockFn<T>;
  mockRejectedValue: (value: unknown) => TypedMockFn<T>;
  mockImplementation: (
    impl: (...args: Parameters<T>) => ReturnType<T>
  ) => TypedMockFn<T>;
  mockReturnValue: (value: ReturnType<T>) => TypedMockFn<T>;
  mockClear: () => TypedMockFn<T>;
  mockReset: () => TypedMockFn<T>;
};

// Type that converts all methods in an object to typed mocks
type MockedMethods<T> = {
  // biome-ignore lint/suspicious/noExplicitAny: recursive type needs any
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? TypedMockFn<T[K]>
    : T[K] extends object
      ? MockedMethods<T[K]>
      : T[K];
};

// Mocked Client type where all methods are type-safe Storybook mocks
export type MockedClient = MockedMethods<Client>;

/**
 * Recursively replace all methods with mocks that reject by default.
 * Stories must explicitly mock methods they use with .mockResolvedValue().
 */
function mockAllMethods(
  obj: object,
  path = "",
  visited = new WeakSet<object>()
): void {
  if (visited.has(obj)) return;
  visited.add(obj);

  for (const key of Object.keys(obj)) {
    // biome-ignore lint/suspicious/noExplicitAny: easier that way
    const value = (obj as any)[key];
    const newPath = path ? `${path}.${key}` : key;

    if (value && typeof value === "object" && value.constructor !== Object) {
      // Nested class instance - recurse into it and also mock its prototype methods
      mockAllMethods(value, newPath, visited);
      for (const method of Object.getOwnPropertyNames(
        Object.getPrototypeOf(value)
      )) {
        if (method !== "constructor" && typeof value[method] === "function") {
          value[method] = fn().mockRejectedValue(
            new Error(`${newPath}.${method} not mocked`)
          );
        }
      }
    }
  }
}

/**
 * Create a mock API client where all methods reject by default.
 * Stories must explicitly mock methods they use with .mockResolvedValue().
 */
export function createMockClient(): MockedClient {
  const client = new Client({ baseURL: "http://mock" });
  mockAllMethods(client);
  return client as unknown as MockedClient;
}

// Current mock client for the active story
let currentMockClient: MockedClient | null = null;

/**
 * Storybook decorator that creates a fresh mock client for each story.
 * Pass a configure function to set up mock responses.
 *
 * @example
 * export const MyStory: Story = {
 *   decorators: [
 *     withMockClient((client) => {
 *       client.agents.setupSlack.getWebhookUrl.mockResolvedValue({ webhook_url: "..." });
 *     }),
 *   ],
 * };
 */
export function withMockClient(configure?: (client: MockedClient) => void) {
  return (Story: StoryFn) => {
    // Create fresh mock client for this story
    currentMockClient = createMockClient();
    if (configure) {
      configure(currentMockClient);
    }
    // @ts-expect-error StoryFn typing
    return <Story />;
  };
}

export const useAPIClient = fn(() => {
  if (!currentMockClient) {
    currentMockClient = createMockClient();
  }
  return currentMockClient as unknown as Client;
});
