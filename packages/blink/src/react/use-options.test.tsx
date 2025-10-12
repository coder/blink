import { expect, test } from "bun:test";
import React, { useEffect } from "react";
import { render } from "ink";
import useOptions from "./use-options";
import type { CapabilitiesResponse } from "../agent/client";

type OptionsSchema = Record<
  string,
  {
    type: "select";
    label: string;
    values: ReadonlyArray<{ id: string; label: string }>;
    defaultValue: string;
  }
>;

type UIMessage = {
  role: string;
  metadata?: any;
};

type Agent = {
  ui: (
    req: { selectedOptions?: Record<string, string> },
    options?: { signal?: AbortSignal }
  ) => Promise<OptionsSchema> | OptionsSchema;
};

type HookResult = ReturnType<typeof useOptions>;

type HarnessProps = {
  agent?: Pick<Agent, "ui">;
  capabilities?: Pick<CapabilitiesResponse, "ui">;
  messages: UIMessage[];
  onUpdate: (result: HookResult) => void;
};

const Harness: React.FC<HarnessProps> = ({
  agent,
  capabilities,
  messages,
  onUpdate,
}) => {
  const result = useOptions({
    agent: agent as any,
    capabilities: capabilities as any,
    messages: messages as any,
  });
  useEffect(() => {
    onUpdate(result);
  }, [result.schema, result.options, result.loading, result.error]);
  return null;
};

function createObserver() {
  let latest: HookResult | undefined;
  let resolvers: Array<(r: HookResult) => void> = [];
  const onUpdate = (r: HookResult) => {
    latest = r;
    const toResolve = resolvers;
    resolvers = [];
    for (const resolve of toResolve) resolve(r);
  };
  const next = () =>
    new Promise<HookResult>((resolve) => {
      resolvers.push(resolve);
    });
  const waitFor = async (
    predicate: (r: HookResult) => boolean,
    timeoutMs = 2000
  ) => {
    const start = Date.now();
    if (latest && predicate(latest)) return latest;
    while (Date.now() - start < timeoutMs) {
      const r = await next();
      if (predicate(r)) return r;
    }
    throw new Error("waitFor timed out");
  };
  const getLatest = () => latest as HookResult;
  return { onUpdate, waitFor, getLatest };
}

const schema: OptionsSchema = {
  model: {
    type: "select",
    label: "Model",
    values: [
      { id: "gpt-4", label: "GPT-4" },
      { id: "sonnet", label: "Sonnet" },
    ],
    defaultValue: "gpt-4",
  },
  temp: {
    type: "select",
    label: "Temperature",
    values: [
      { id: "low", label: "Low" },
      { id: "high", label: "High" },
    ],
    defaultValue: "low",
  },
};

function makeAgent(
  impl?: (req: {
    selectedOptions?: Record<string, string>;
  }) => OptionsSchema | Promise<OptionsSchema>
): Agent & { calls: { req: any }[] } {
  const calls: { req: any }[] = [];
  return {
    calls,
    ui: async (req) => {
      calls.push({ req });
      if (impl) return await impl(req);
      return schema;
    },
  } as Agent & { calls: { req: any }[] };
}

test("returns empty state when agent is missing or options are disabled", async () => {
  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness capabilities={{ ui: true }} messages={[]} onUpdate={onUpdate} />
  );

  const r = await waitFor(() => true);
  expect(r.schema).toBeUndefined();
  expect(r.options).toBeUndefined();
  expect(r.error).toBeUndefined();

  app.unmount();
});

test("fetches schema and merges message options with defaults and filtering", async () => {
  const lastMessage: UIMessage = {
    role: "user",
    metadata: { options: { model: "gpt-5", temp: "high", extra: "foo" } },
  };
  const agent = makeAgent();
  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      agent={agent}
      capabilities={{ ui: true }}
      messages={[lastMessage]}
      onUpdate={onUpdate}
    />
  );

  const r = await waitFor((s) => !!s.schema && s.loading === false);
  expect(agent.calls.length).toBeGreaterThanOrEqual(1);
  expect(r.schema).toBeDefined();
  expect(r.error).toBeUndefined();

  const rFinal = await waitFor(
    (s) => s.options?.model === "gpt-4" && s.options?.temp === "high"
  );
  expect(rFinal.options).toEqual({ model: "gpt-4", temp: "high" });

  rFinal.setOption("model", "sonnet");
  const r2 = await waitFor((s) => s.options?.model === "sonnet");
  expect(r2.options).toEqual({ model: "sonnet", temp: "high" });

  const before = getLatest().options;
  r2.setOption("model", "invalid-value");
  const after = getLatest().options;
  expect(after).toBe(before!);

  app.unmount();
});

test("resets state when capabilities change to disable options", async () => {
  const agent = makeAgent();
  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      agent={agent}
      capabilities={{ ui: true }}
      messages={[]}
      onUpdate={onUpdate}
    />
  );

  await waitFor((s) => !!s.schema && s.loading === false);

  app.rerender(
    <Harness
      agent={agent}
      capabilities={{ ui: false }}
      messages={[]}
      onUpdate={onUpdate}
    />
  );

  const r2 = await waitFor(
    (s) => s.schema === undefined && s.options === undefined
  );
  expect(r2.error).toBeUndefined();

  app.unmount();
});

test("does not refetch schema after initial defaults are applied", async () => {
  const agent = makeAgent();
  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      agent={agent}
      capabilities={{ ui: true }}
      messages={[]}
      onUpdate={onUpdate}
    />
  );

  // Wait until schema is loaded and options are fully resolved with defaults
  const r = await waitFor(
    (s) =>
      !!s.schema &&
      s.options?.model === "gpt-4" &&
      s.options?.temp === "low" &&
      s.loading === false
  );

  // Expect two calls: initial empty selection, then after defaults are applied
  expect(agent.calls.length).toBe(2);

  app.unmount();
});

test("does not fetch when setting an option to the same value", async () => {
  const agent = makeAgent();
  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      agent={agent}
      capabilities={{ ui: true }}
      messages={[]}
      onUpdate={onUpdate}
    />
  );

  const r = await waitFor(
    (s) => !!s.schema && !!s.options && s.loading === false
  );
  const callsBefore = agent.calls.length;

  // Setting the option to its current value should not cause any state change nor a refetch
  const currentModel = (r.options as Record<string, string>)["model"]!;
  getLatest().setOption("model", currentModel);

  expect(agent.calls.length).toBe(callsBefore);

  app.unmount();
});

test("does not refetch when non-options capabilities change", async () => {
  const agent = makeAgent();
  const { onUpdate, waitFor } = createObserver();
  const app = render(
    <Harness
      agent={agent}
      capabilities={{ ui: true }}
      messages={[]}
      onUpdate={onUpdate}
    />
  );

  await waitFor((s) => !!s.schema && !!s.options && s.loading === false);
  const callsBefore = agent.calls.length;

  // Change capabilities that are unrelated to options; should not refetch
  app.rerender(
    <Harness
      agent={agent}
      capabilities={{ ui: true }}
      messages={[]}
      onUpdate={onUpdate}
    />
  );

  // Wait a tick for possible updates
  await new Promise((r) => setTimeout(r, 0));

  expect(agent.calls.length).toBe(callsBefore);

  app.unmount();
});

test("prunes options when schema removes a field after selection changes", async () => {
  const dynamicAgent = makeAgent(({ selectedOptions }) => {
    const base = {
      model: {
        type: "select" as const,
        label: "Model",
        values: [
          { id: "gpt-5", label: "GPT-5" },
          { id: "sonnet", label: "Sonnet" },
        ],
        defaultValue: "gpt-5",
      },
    } as const;
    if (selectedOptions?.model === "gpt-5") {
      return {
        ...base,
        reasoningEffort: {
          type: "select" as const,
          label: "Reasoning Effort",
          values: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          defaultValue: "low",
        },
      };
    }
    return base as any;
  });

  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      agent={dynamicAgent}
      capabilities={{ ui: true }}
      messages={[]}
      onUpdate={onUpdate}
    />
  );

  // Wait for initial schema with defaults (model=gpt-5, reasoningEffort=low)
  await waitFor(
    (s) =>
      !!s.schema &&
      s.options?.model === "gpt-5" &&
      s.options?.["reasoningEffort"] === "low" &&
      s.loading === false
  );

  // Switch to gpt-5 explicitly to ensure reasoningEffort is present
  getLatest().setOption("model", "gpt-5");
  await waitFor(
    (s) =>
      s.options?.model === "gpt-5" && s.options?.["reasoningEffort"] === "low"
  );

  // Now switch to sonnet which should remove reasoningEffort from schema and options
  getLatest().setOption("model", "sonnet");
  const r = await waitFor(
    (s) =>
      s.options?.model === "sonnet" && !("reasoningEffort" in (s.options ?? {}))
  );
  expect(r.options).toEqual({ model: "sonnet" });

  app.unmount();
});

test("resets and fetches fresh schema when the agent changes", async () => {
  const agentA = makeAgent(
    () =>
      ({
        model: {
          type: "select",
          label: "Model",
          values: [
            { id: "gpt-4", label: "GPT-4" },
            { id: "sonnet", label: "Sonnet" },
          ],
          defaultValue: "gpt-4",
        },
      }) as any
  );

  const agentB = makeAgent(
    () =>
      ({
        model: {
          type: "select",
          label: "Model",
          values: [
            { id: "gpt-3.5", label: "GPT-3.5" },
            { id: "mistral", label: "Mistral" },
          ],
          defaultValue: "mistral",
        },
      }) as any
  );

  const { onUpdate, waitFor, getLatest } = createObserver();
  const app = render(
    <Harness
      agent={agentA}
      capabilities={{ ui: true }}
      messages={[]}
      onUpdate={onUpdate}
    />
  );

  // Load first agent and change a value away from defaults
  await waitFor(
    (s) => !!s.schema && s.options?.model === "gpt-4" && s.loading === false
  );
  getLatest().setOption("model", "sonnet");
  await waitFor((s) => s.options?.model === "sonnet");
  const callsAgentABefore = agentA.calls.length;

  // Switch to second agent
  app.rerender(
    <Harness
      agent={agentB}
      capabilities={{ ui: true }}
      messages={[]}
      onUpdate={onUpdate}
    />
  );

  // Should fetch new schema and apply new defaults; prior selections must be discarded
  const r = await waitFor(
    (s) => !!s.schema && s.options?.model === "mistral" && s.loading === false
  );
  expect(agentB.calls.length).toBeGreaterThanOrEqual(1);
  expect(r.options).toEqual({ model: "mistral" });

  // Ensure the first agent was not called again after the switch
  expect(agentA.calls.length).toBe(callsAgentABefore);

  app.unmount();
});
