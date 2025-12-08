import { create } from "@bufbuild/protobuf";
import { describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

import { toBinary } from "@bufbuild/protobuf";
import type { Bindings } from "../../server";
import { generateAgentInvocationToken } from "../agents/me/me.server";
import type { OtelSpan } from "./convert";
import { ExportTraceServiceRequestSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";
import {
  AnyValueSchema,
  InstrumentationScopeSchema,
  KeyValueSchema,
} from "./gen/opentelemetry/proto/common/v1/common_pb";
import { ResourceSchema } from "./gen/opentelemetry/proto/resource/v1/resource_pb";
import {
  ResourceSpansSchema,
  ScopeSpansSchema,
  SpanSchema,
  Span_SpanKind,
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

// Helper function to create mock bindings
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
  });
});
