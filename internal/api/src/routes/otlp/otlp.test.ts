/** biome-ignore-all lint/suspicious/noExplicitAny: tests */

import { describe, expect, mock, test } from "bun:test";
import { create, toBinary } from "@bufbuild/protobuf";
import { Hono } from "hono";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import type { Bindings } from "../../server";
import { serve } from "../../test";
import {
  generateAgentDeploymentToken,
  generateAgentInvocationToken,
} from "../agents/me/me.server";
import type { OtelSpan } from "./convert";
import { ExportLogsServiceRequestSchema } from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb";
import { ExportTraceServiceRequestSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";
import {
  AnyValueSchema,
  InstrumentationScopeSchema,
  KeyValueSchema,
} from "./gen/opentelemetry/proto/common/v1/common_pb";
import {
  LogRecordSchema,
  ResourceLogsSchema,
  ScopeLogsSchema,
  SeverityNumber,
} from "./gen/opentelemetry/proto/logs/v1/logs_pb";
import { ResourceSchema } from "./gen/opentelemetry/proto/resource/v1/resource_pb";
import {
  ResourceSpansSchema,
  ScopeSpansSchema,
  Span_SpanKind,
  SpanSchema,
} from "./gen/opentelemetry/proto/trace/v1/trace_pb";
import mountOtlp from "./otlp.server";

// Helper function to create mock Uint8Array IDs
function createMockId(hexString: string): Uint8Array {
  const bytes =
    hexString.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [];
  return new Uint8Array(bytes);
}

// Helper function to create mock KeyValue attributes
function createMockAttribute(key: string, value: string) {
  return create(KeyValueSchema, {
    key,
    value: create(AnyValueSchema, {
      value: {
        case: "stringValue",
        value,
      },
    }),
  });
}

// Helper function to create a mock trace request
function createMockTraceRequest() {
  const mockSpan = create(SpanSchema, {
    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
    spanId: createMockId("1234567890abcdef"),
    parentSpanId: createMockId("fedcba0987654321"),
    name: "test-span",
    kind: Span_SpanKind.INTERNAL,
    startTimeUnixNano: BigInt("1640995200000000000"),
    endTimeUnixNano: BigInt("1640995201000000000"),
    attributes: [createMockAttribute("service.name", "test-service")],
  });

  const mockScopeSpans = create(ScopeSpansSchema, {
    scope: create(InstrumentationScopeSchema, {
      name: "test-instrumentation",
      version: "1.0.0",
    }),
    spans: [mockSpan],
  });

  const mockResourceSpans = create(ResourceSpansSchema, {
    resource: create(ResourceSchema, {
      attributes: [createMockAttribute("service.name", "test-app")],
    }),
    scopeSpans: [mockScopeSpans],
  });

  return create(ExportTraceServiceRequestSchema, {
    resourceSpans: [mockResourceSpans],
  });
}

// Helper function to create mock bindings for traces tests
function createMockBindings(): Bindings {
  const mockTracesWrite = mock(() => Promise.resolve());

  return {
    AUTH_SECRET: "test-secret",
    traces: {
      write: mockTracesWrite,
    },
    database: mock(() => Promise.resolve({} as any)),
    logs: {
      write: mock(() => Promise.resolve()),
    },
  } as any;
}

describe("OTLP Server", () => {
  describe("POST /v1/traces", () => {
    test("should authenticate and process traces with all IDs from token", async () => {
      // Setup
      const app = new Hono<{ Bindings: Bindings }>();
      const bindings = createMockBindings();
      mountOtlp(app);

      const tokenPayload = {
        agent_id: "test-agent-123",
        agent_deployment_id: "test-deployment-456",
        agent_deployment_target_id: "test-target-789",
        run_id: "test-run-abc",
        step_id: "test-step-def",
      };

      const token = await generateAgentInvocationToken(
        bindings.AUTH_SECRET,
        tokenPayload
      );

      // Create request with authorization header
      const request = new Request("http://localhost/v1/traces", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-protobuf",
        },
        body: toBinary(
          ExportTraceServiceRequestSchema,
          createMockTraceRequest()
        ),
      });

      // Execute
      const response = await app.fetch(request, bindings);

      // Verify response
      expect(response.status).toBe(200);
      const responseJson = await response.json();
      expect(responseJson).toHaveProperty(
        "$typeName",
        "opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse"
      );

      // Verify traces.write was called with correct parameters
      expect(bindings.traces.write).toHaveBeenCalledTimes(1);
      const [spans] = (bindings.traces.write as any).mock.calls[0] as [
        OtelSpan[],
      ];

      expect(spans).toHaveLength(1);
      expect(spans[0].agent_id).toBe("test-agent-123");
      expect(spans[0].payload.resource.attributes.blink).toEqual({
        agent_id: "test-agent-123",
        deployment_id: "test-deployment-456",
        deployment_target_id: "test-target-789",
        run_id: "test-run-abc",
        step_id: "test-step-def",
      });
    });

    test("should work with optional run_id and step_id missing", async () => {
      // Setup
      const app = new Hono<{ Bindings: Bindings }>();
      const bindings = createMockBindings();
      mountOtlp(app);

      const tokenPayload = {
        agent_id: "test-agent-123",
        agent_deployment_id: "test-deployment-456",
        agent_deployment_target_id: "test-target-789",
        // run_id and step_id omitted
      };

      const token = await generateAgentInvocationToken(
        bindings.AUTH_SECRET,
        tokenPayload
      );

      const request = new Request("http://localhost/v1/traces", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-protobuf",
        },
        body: toBinary(
          ExportTraceServiceRequestSchema,
          createMockTraceRequest()
        ),
      });

      // Execute
      const response = await app.fetch(request, bindings);

      // Verify response
      expect(response.status).toBe(200);

      // Verify traces.write was called with correct parameters
      expect(bindings.traces.write).toHaveBeenCalledTimes(1);
      const [spans] = (bindings.traces.write as any).mock.calls[0] as [
        OtelSpan[],
      ];

      expect(spans).toHaveLength(1);
      expect(spans[0].payload.resource.attributes.blink).toEqual({
        agent_id: "test-agent-123",
        deployment_id: "test-deployment-456",
        deployment_target_id: "test-target-789",
        // run_id and step_id should not be present
      });
      expect(spans[0].payload.resource.attributes.blink).not.toHaveProperty(
        "run_id"
      );
      expect(spans[0].payload.resource.attributes.blink).not.toHaveProperty(
        "step_id"
      );
    });

    test("should work with only run_id present", async () => {
      // Setup
      const app = new Hono<{ Bindings: Bindings }>();
      const bindings = createMockBindings();
      mountOtlp(app);

      const tokenPayload = {
        agent_id: "test-agent-123",
        agent_deployment_id: "test-deployment-456",
        agent_deployment_target_id: "test-target-789",
        run_id: "test-run-abc",
        // step_id omitted
      };

      const token = await generateAgentInvocationToken(
        bindings.AUTH_SECRET,
        tokenPayload
      );

      const request = new Request("http://localhost/v1/traces", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-protobuf",
        },
        body: toBinary(
          ExportTraceServiceRequestSchema,
          createMockTraceRequest()
        ),
      });

      // Execute
      const response = await app.fetch(request, bindings);

      // Verify response
      expect(response.status).toBe(200);

      // Verify traces.write was called with correct parameters
      const [spans] = (bindings.traces.write as any).mock.calls[0] as [
        OtelSpan[],
      ];

      expect(spans[0].payload.resource.attributes.blink).toEqual({
        agent_id: "test-agent-123",
        deployment_id: "test-deployment-456",
        deployment_target_id: "test-target-789",
        run_id: "test-run-abc",
      });
      expect(spans[0].payload.resource.attributes.blink).not.toHaveProperty(
        "step_id"
      );
    });

    test("should return 401 when no authorization header", async () => {
      // Setup
      const app = new Hono<{ Bindings: Bindings }>();
      const bindings = createMockBindings();
      mountOtlp(app);

      const request = new Request("http://localhost/v1/traces", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-protobuf",
        },
        body: new Uint8Array(),
      });

      // Execute
      const response = await app.fetch(request, bindings);

      // Verify
      expect(response.status).toBe(401);
      expect(bindings.traces.write).not.toHaveBeenCalled();
    });

    test("should return 401 when token is invalid", async () => {
      // Setup
      const app = new Hono<{ Bindings: Bindings }>();
      const bindings = createMockBindings();
      mountOtlp(app);

      const request = new Request("http://localhost/v1/traces", {
        method: "POST",
        headers: {
          Authorization: "Bearer invalid-token",
          "Content-Type": "application/x-protobuf",
        },
        body: new Uint8Array(),
      });

      // Execute
      const response = await app.fetch(request, bindings);

      // Verify
      expect(response.status).toBe(401);
      expect(bindings.traces.write).not.toHaveBeenCalled();
    });

    test("should return 401 when token is missing required fields", async () => {
      // Setup
      const app = new Hono<{ Bindings: Bindings }>();
      const bindings = createMockBindings();
      mountOtlp(app);

      const tokenPayload = {
        agent_id: "test-agent-123",
        // Missing agent_deployment_id and agent_deployment_target_id
      };

      const token = await generateAgentInvocationToken(
        bindings.AUTH_SECRET,
        tokenPayload as any
      );

      const request = new Request("http://localhost/v1/traces", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-protobuf",
        },
        body: new Uint8Array(),
      });

      // Execute
      const response = await app.fetch(request, bindings);

      // Verify
      expect(response.status).toBe(401);
      expect(bindings.traces.write).not.toHaveBeenCalled();
    });

    test.each([
      { encoding: "gzip", compress: gzipSync },
      { encoding: "deflate", compress: deflateSync },
      { encoding: "br", compress: brotliCompressSync },
    ])(
      "should handle $encoding compressed body",
      async ({ encoding, compress }) => {
        // Setup
        const app = new Hono<{ Bindings: Bindings }>();
        const bindings = createMockBindings();
        mountOtlp(app);

        const tokenPayload = {
          agent_id: "test-agent-123",
          agent_deployment_id: "test-deployment-456",
          agent_deployment_target_id: "test-target-789",
        };

        const token = await generateAgentInvocationToken(
          bindings.AUTH_SECRET,
          tokenPayload
        );

        // Create uncompressed protobuf body, then compress it
        const uncompressedBody = toBinary(
          ExportTraceServiceRequestSchema,
          createMockTraceRequest()
        );
        const compressedBody = compress(uncompressedBody);

        const request = new Request("http://localhost/v1/traces", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-protobuf",
            "Content-Encoding": encoding,
          },
          body: compressedBody,
        });

        const response = await app.fetch(request, bindings);

        expect(response.status).toBe(200);
        expect(bindings.traces.write).toHaveBeenCalled();
      }
    );
  });
});

describe("OTLP Server - Traces with Deployment Token", () => {
  // Helper to create a ResourceSpans with blink IDs in span attributes
  function createResourceSpansWithBlinkIds(
    blinkIds: { run_id?: string; step_id?: string; chat_id?: string },
    spanName = "test-span"
  ) {
    // Create span attributes with flat blink.* keys
    const spanAttributes: ReturnType<typeof create<typeof KeyValueSchema>>[] =
      [];
    for (const [key, value] of Object.entries(blinkIds)) {
      spanAttributes.push(
        create(KeyValueSchema, {
          key: `blink.${key}`,
          value: create(AnyValueSchema, {
            value: { case: "stringValue", value },
          }),
        })
      );
    }
    return create(ResourceSpansSchema, {
      resource: create(ResourceSchema, {
        attributes: [createMockAttribute("service.name", "test-app")],
      }),
      scopeSpans: [
        create(ScopeSpansSchema, {
          scope: create(InstrumentationScopeSchema, {
            name: "test-instrumentation",
            version: "1.0.0",
          }),
          spans: [
            create(SpanSchema, {
              traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
              spanId: createMockId("1234567890abcdef"),
              parentSpanId: createMockId("fedcba0987654321"),
              name: spanName,
              kind: Span_SpanKind.INTERNAL,
              startTimeUnixNano: BigInt("1640995200000000000"),
              endTimeUnixNano: BigInt("1640995201000000000"),
              attributes: spanAttributes,
            }),
          ],
        }),
      ],
    });
  }

  // Helper function to create a mock trace request with blink IDs in span attributes
  function createMockTraceRequestWithBlinkIds(blinkIds: {
    run_id?: string;
    step_id?: string;
    chat_id?: string;
  }) {
    return create(ExportTraceServiceRequestSchema, {
      resourceSpans: [createResourceSpansWithBlinkIds(blinkIds)],
    });
  }

  // Helper to create a trace request with given token and blink IDs
  function createTraceRequest(
    url: string | URL,
    token: string,
    blinkIds: { run_id?: string; step_id?: string; chat_id?: string }
  ) {
    return new Request(new URL("/api/otlp/v1/traces", url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-protobuf",
      },
      body: toBinary(
        ExportTraceServiceRequestSchema,
        createMockTraceRequestWithBlinkIds(blinkIds)
      ),
    });
  }

  // Helper to set up isolated test environment
  async function setupTestEnv() {
    const mockTracesWrite = mock(() => Promise.resolve());
    const { helpers, bindings, url } = await serve({
      bindings: {
        traces: {
          write: mockTracesWrite,
        },
      },
    });

    const { client } = await helpers.createUser();
    const org = await client.organizations.create({ name: "test-org" });
    const agent = await client.agents.create({
      name: "test-agent",
      description: "Test Description",
      organization_id: org.id,
    });
    const deployment = await client.agents.deployments.create({
      agent_id: agent.id,
      target: "production",
      output_files: [{ path: "test.js", data: "console.log('Hello');" }],
    });
    const target = await (
      await bindings.database()
    ).selectAgentDeploymentTargetByName(agent.id, "production");
    if (!target) {
      throw new Error("Target not found");
    }

    const deploymentToken = await generateAgentDeploymentToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: deployment.id,
        agent_deployment_target_id: target.id,
      }
    );

    const invocationToken = await generateAgentInvocationToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: deployment.id,
        agent_deployment_target_id: target.id,
        run_id: "invocation-run-id",
        step_id: "invocation-step-id",
        chat_id: "invocation-chat-id",
      }
    );

    return {
      mockTracesWrite,
      bindings,
      url,
      agent,
      deployment,
      target,
      deploymentToken,
      invocationToken,
    };
  }

  test.each([
    {
      name: "all blink IDs",
      inputBlinkIds: {
        run_id: "extracted-run-id",
        step_id: "extracted-step-id",
        chat_id: "extracted-chat-id",
      },
      expectedExtraBlinkIds: {
        run_id: "extracted-run-id",
        step_id: "extracted-step-id",
        chat_id: "extracted-chat-id",
      },
    },
    {
      name: "no blink IDs",
      inputBlinkIds: {},
      expectedExtraBlinkIds: {},
    },
    {
      name: "only run_id",
      inputBlinkIds: { run_id: "only-run-id" },
      expectedExtraBlinkIds: { run_id: "only-run-id" },
    },
  ])(
    "should extract $name from span attributes with deployment token",
    async ({ inputBlinkIds, expectedExtraBlinkIds }) => {
      const {
        mockTracesWrite,
        url,
        agent,
        deployment,
        target,
        deploymentToken,
      } = await setupTestEnv();

      const request = createTraceRequest(url, deploymentToken, inputBlinkIds);
      const response = await fetch(request);

      expect(response.status).toBe(200);
      expect(mockTracesWrite).toHaveBeenCalledTimes(1);

      const [spans] = mockTracesWrite.mock.calls[0] as unknown as [OtelSpan[]];
      expect(spans).toHaveLength(1);
      expect(spans[0].agent_id).toBe(agent.id);
      expect(spans[0].payload.resource.attributes.blink).toEqual({
        agent_id: agent.id,
        deployment_id: deployment.id,
        deployment_target_id: target.id,
        ...expectedExtraBlinkIds,
      });
    }
  );

  test("should prefer invocation token over deployment token and use IDs from token", async () => {
    const { mockTracesWrite, url, agent, deployment, target, invocationToken } =
      await setupTestEnv();

    // Resource attributes have different IDs that should be ignored
    const request = createTraceRequest(url, invocationToken, {
      run_id: "should-not-use-this",
      step_id: "should-not-use-this",
      chat_id: "should-not-use-this",
    });

    const response = await fetch(request);

    expect(response.status).toBe(200);
    expect(mockTracesWrite).toHaveBeenCalledTimes(1);

    const [spans] = mockTracesWrite.mock.calls[0] as unknown as [OtelSpan[]];
    expect(spans[0].payload.resource.attributes.blink).toEqual({
      agent_id: agent.id,
      deployment_id: deployment.id,
      deployment_target_id: target.id,
      run_id: "invocation-run-id",
      step_id: "invocation-step-id",
      chat_id: "invocation-chat-id",
    });
  });

  test("should extract different blink IDs from each span with deployment token", async () => {
    const { mockTracesWrite, url, agent, deployment, target, deploymentToken } =
      await setupTestEnv();

    // Create request with two ResourceSpans with different blink IDs
    const multiResourceRequest = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        createResourceSpansWithBlinkIds(
          {
            run_id: "first-run-id",
            step_id: "first-step-id",
            chat_id: "first-chat-id",
          },
          "first-span"
        ),
        createResourceSpansWithBlinkIds(
          {
            run_id: "second-run-id",
            step_id: "second-step-id",
            chat_id: "second-chat-id",
          },
          "second-span"
        ),
      ],
    });

    const request = new Request(new URL("/api/otlp/v1/traces", url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deploymentToken}`,
        "Content-Type": "application/x-protobuf",
      },
      body: toBinary(ExportTraceServiceRequestSchema, multiResourceRequest),
    });

    const response = await fetch(request);

    expect(response.status).toBe(200);
    expect(mockTracesWrite).toHaveBeenCalledTimes(1);

    const [spans] = mockTracesWrite.mock.calls[0] as unknown as [OtelSpan[]];
    expect(spans).toHaveLength(2);

    // First span should have first resource's IDs
    expect(spans[0].payload.span.name).toBe("first-span");
    expect(spans[0].payload.resource.attributes.blink).toEqual({
      agent_id: agent.id,
      deployment_id: deployment.id,
      deployment_target_id: target.id,
      run_id: "first-run-id",
      step_id: "first-step-id",
      chat_id: "first-chat-id",
    });

    // Second span should have second resource's IDs
    expect(spans[1].payload.span.name).toBe("second-span");
    expect(spans[1].payload.resource.attributes.blink).toEqual({
      agent_id: agent.id,
      deployment_id: deployment.id,
      deployment_target_id: target.id,
      run_id: "second-run-id",
      step_id: "second-step-id",
      chat_id: "second-chat-id",
    });
  });

  test("should return 401 for invalid deployment token (non-existent deployment)", async () => {
    const { mockTracesWrite, bindings, url, agent, target } =
      await setupTestEnv();

    const invalidToken = await generateAgentDeploymentToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: crypto.randomUUID(),
        agent_deployment_target_id: target.id,
      }
    );

    const request = createTraceRequest(url, invalidToken, {});
    const response = await fetch(request);

    expect(response.status).toBe(401);
    expect(mockTracesWrite).not.toHaveBeenCalled();
  });
});

describe("OTLP Server - Logs", () => {
  // Helper to set up isolated test environment
  async function setupLogsTestEnv() {
    const mockLogsWrite = mock(() => Promise.resolve());
    const { helpers, bindings, url } = await serve({
      bindings: {
        logs: {
          write: mockLogsWrite,
        },
      },
    });

    const { client } = await helpers.createUser();
    const org = await client.organizations.create({ name: "test-org" });
    const agent = await client.agents.create({
      name: "test-agent",
      description: "Test Description",
      organization_id: org.id,
    });
    const deployment = await client.agents.deployments.create({
      agent_id: agent.id,
      target: "production",
      output_files: [{ path: "test.js", data: "console.log('Hello');" }],
    });
    const target = await (
      await bindings.database()
    ).selectAgentDeploymentTargetByName(agent.id, "production");
    if (!target) {
      throw new Error("Target not found");
    }

    const deploymentToken = await generateAgentDeploymentToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: deployment.id,
        agent_deployment_target_id: target.id,
      }
    );

    const invocationToken = await generateAgentInvocationToken(
      bindings.AUTH_SECRET,
      {
        agent_id: agent.id,
        agent_deployment_id: deployment.id,
        agent_deployment_target_id: target.id,
      }
    );

    return {
      mockLogsWrite,
      bindings,
      url,
      agent,
      deployment,
      target,
      deploymentToken,
      invocationToken,
    };
  }

  test("should authenticate and process logs with deployment token", async () => {
    const { mockLogsWrite, url, agent, deploymentToken } =
      await setupLogsTestEnv();

    const request = new Request(new URL("/api/otlp/v1/logs", url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deploymentToken}`,
        "Content-Type": "application/x-protobuf",
      },
      body: toBinary(ExportLogsServiceRequestSchema, createMockLogsRequest()),
    });

    const response = await fetch(request);

    expect(response.status).toBe(200);
    const responseJson = await response.json();
    expect(responseJson).toHaveProperty(
      "$typeName",
      "opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse"
    );

    expect(mockLogsWrite).toHaveBeenCalledTimes(1);
    const call = mockLogsWrite.mock.calls[0] as unknown as [
      { agent_id: string; event: Record<string, unknown> },
    ];

    expect(call[0].agent_id).toBe(agent.id);
    expect(call[0].event.message).toBe("This is a test log message");
  });

  test("should process multiple log records", async () => {
    const { mockLogsWrite, url, deploymentToken } = await setupLogsTestEnv();

    const multiLogRequest = create(ExportLogsServiceRequestSchema, {
      resourceLogs: [
        create(ResourceLogsSchema, {
          resource: create(ResourceSchema, {
            attributes: [createMockAttribute("service.name", "test-app")],
          }),
          scopeLogs: [
            create(ScopeLogsSchema, {
              scope: create(InstrumentationScopeSchema, {
                name: "test-logger",
              }),
              logRecords: [
                create(LogRecordSchema, {
                  timeUnixNano: BigInt("1640995200000000000"),
                  severityNumber: SeverityNumber.INFO,
                  body: create(AnyValueSchema, {
                    value: { case: "stringValue", value: "First log" },
                  }),
                }),
                create(LogRecordSchema, {
                  timeUnixNano: BigInt("1640995201000000000"),
                  severityNumber: SeverityNumber.ERROR,
                  body: create(AnyValueSchema, {
                    value: { case: "stringValue", value: "Second log" },
                  }),
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const request = new Request(new URL("/api/otlp/v1/logs", url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deploymentToken}`,
        "Content-Type": "application/x-protobuf",
      },
      body: toBinary(ExportLogsServiceRequestSchema, multiLogRequest),
    });

    const response = await fetch(request);

    expect(response.status).toBe(200);
    expect(mockLogsWrite).toHaveBeenCalledTimes(2);
  });

  test("should return 401 when no authorization header", async () => {
    const { mockLogsWrite, url } = await setupLogsTestEnv();

    const request = new Request(new URL("/api/otlp/v1/logs", url), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-protobuf",
      },
      body: new Uint8Array(),
    });

    const response = await fetch(request);

    expect(response.status).toBe(401);
    expect(mockLogsWrite).not.toHaveBeenCalled();
  });

  test("should return 401 when token is invalid", async () => {
    const { mockLogsWrite, url } = await setupLogsTestEnv();

    const request = new Request(new URL("/api/otlp/v1/logs", url), {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid-token",
        "Content-Type": "application/x-protobuf",
      },
      body: new Uint8Array(),
    });

    const response = await fetch(request);

    expect(response.status).toBe(401);
    expect(mockLogsWrite).not.toHaveBeenCalled();
  });

  test.each([
    { encoding: "gzip", compress: gzipSync },
    { encoding: "deflate", compress: deflateSync },
    { encoding: "br", compress: brotliCompressSync },
  ])(
    "should handle $encoding compressed body",
    async ({ encoding, compress }) => {
      const { mockLogsWrite, url, deploymentToken } = await setupLogsTestEnv();

      const uncompressedBody = toBinary(
        ExportLogsServiceRequestSchema,
        createMockLogsRequest()
      );
      const compressedBody = compress(uncompressedBody);

      const request = new Request(new URL("/api/otlp/v1/logs", url), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${deploymentToken}`,
          "Content-Type": "application/x-protobuf",
          "Content-Encoding": encoding,
        },
        body: compressedBody,
      });

      const response = await fetch(request);

      expect(response.status).toBe(200);
      expect(mockLogsWrite).toHaveBeenCalled();
    }
  );

  test("should reject invocation token for logs endpoint", async () => {
    const { mockLogsWrite, url, invocationToken } = await setupLogsTestEnv();

    const request = new Request(new URL("/api/otlp/v1/logs", url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${invocationToken}`,
        "Content-Type": "application/x-protobuf",
      },
      body: toBinary(ExportLogsServiceRequestSchema, createMockLogsRequest()),
    });

    const response = await fetch(request);

    expect(response.status).toBe(401);
    expect(mockLogsWrite).not.toHaveBeenCalled();
  });
});

// Helper function to create a mock logs request
function createMockLogsRequest() {
  const mockLogRecord = create(LogRecordSchema, {
    timeUnixNano: BigInt("1640995200000000000"), // 2022-01-01 00:00:00 UTC
    observedTimeUnixNano: BigInt("1640995200100000000"),
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: create(AnyValueSchema, {
      value: {
        case: "stringValue",
        value: "This is a test log message",
      },
    }),
    attributes: [
      createMockAttribute("log.source", "test-source"),
      createMockAttribute("custom.field", "custom-value"),
    ],
    droppedAttributesCount: 0,
    flags: 1,
    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
    spanId: createMockId("1234567890abcdef"),
    eventName: "test-event",
  });

  const mockScopeLogs = create(ScopeLogsSchema, {
    scope: create(InstrumentationScopeSchema, {
      name: "test-logger",
      version: "1.0.0",
      attributes: [createMockAttribute("logger.language", "typescript")],
      droppedAttributesCount: 0,
    }),
    logRecords: [mockLogRecord],
    schemaUrl: "https://opentelemetry.io/schemas/1.9.0",
  });

  const mockResourceLogs = create(ResourceLogsSchema, {
    resource: create(ResourceSchema, {
      attributes: [
        createMockAttribute("service.name", "test-app"),
        createMockAttribute("service.version", "1.0.0"),
      ],
      droppedAttributesCount: 0,
    }),
    scopeLogs: [mockScopeLogs],
    schemaUrl: "https://opentelemetry.io/schemas/1.9.0",
  });

  return create(ExportLogsServiceRequestSchema, {
    resourceLogs: [mockResourceLogs],
  });
}
