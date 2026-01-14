/** biome-ignore-all lint/complexity/useLiteralKeys: test file */
/** biome-ignore-all lint/suspicious/noApproximativeNumericConstant: test file */
/** biome-ignore-all lint/suspicious/noExplicitAny: test file */

import { describe, expect, test } from "bun:test";
import { create, toBinary } from "@bufbuild/protobuf";
import {
  type LogOptions,
  mapExportLogsServiceRequestToLogEvents,
  mapExportTraceServiceRequestToOtelSpans,
  parseOtlpHttpLogs,
  parseOtlpHttpTraces,
  type TraceOptions,
} from "./convert";
import { ExportLogsServiceRequestSchema } from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb";
import { ExportTraceServiceRequestSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";
import {
  AnyValueSchema,
  ArrayValueSchema,
  InstrumentationScopeSchema,
  KeyValueListSchema,
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
  Span_EventSchema,
  Span_LinkSchema,
  Span_SpanKind,
  SpanSchema,
  Status_StatusCode,
  StatusSchema,
} from "./gen/opentelemetry/proto/trace/v1/trace_pb";

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

// Helper function to create mock TraceOptions
function createMockOptions(): TraceOptions {
  return {
    agent_id: "test-agent-123",
    deployment_id: "test-deployment-456",
    deployment_target_id: "test-target-def",
    run_id: "test-run-789",
    step_id: "test-step-abc",
  };
}

// Helper function to create mock ExportTraceServiceRequest
function createMockTraceRequest() {
  const mockEvent = create(Span_EventSchema, {
    timeUnixNano: BigInt("1640995200500000000"),
    name: "test-event",
    attributes: [createMockAttribute("event.type", "log")],
    droppedAttributesCount: 0,
  });

  const mockLink = create(Span_LinkSchema, {
    traceId: createMockId("deadbeefcafebabe1234567890abcdef"),
    spanId: createMockId("cafebabe12345678"),
    attributes: [createMockAttribute("link.type", "reference")],
    traceState: "vendor=test",
    flags: 1,
    droppedAttributesCount: 0,
  });

  const mockSpan = create(SpanSchema, {
    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
    spanId: createMockId("1234567890abcdef"),
    parentSpanId: createMockId("fedcba0987654321"),
    name: "test-span",
    kind: Span_SpanKind.INTERNAL,
    startTimeUnixNano: BigInt("1640995200000000000"), // 2022-01-01 00:00:00 UTC
    endTimeUnixNano: BigInt("1640995201000000000"), // 2022-01-01 00:00:01 UTC
    attributes: [
      createMockAttribute("service.name", "test-service"),
      createMockAttribute("span.kind", "internal"),
    ],
    events: [mockEvent],
    links: [mockLink],
    status: create(StatusSchema, {
      code: Status_StatusCode.OK,
      message: "Success",
    }),
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    flags: 0,
    traceState: "",
  });

  const mockScopeSpans = create(ScopeSpansSchema, {
    scope: create(InstrumentationScopeSchema, {
      name: "test-instrumentation",
      version: "1.0.0",
      attributes: [createMockAttribute("library.language", "typescript")],
      droppedAttributesCount: 0,
    }),
    spans: [mockSpan],
    schemaUrl: "https://opentelemetry.io/schemas/1.9.0",
  });

  const mockResourceSpans = create(ResourceSpansSchema, {
    resource: create(ResourceSchema, {
      attributes: [
        createMockAttribute("service.name", "test-app"),
        createMockAttribute("service.version", "1.0.0"),
      ],
      droppedAttributesCount: 0,
    }),
    scopeSpans: [mockScopeSpans],
    schemaUrl: "https://opentelemetry.io/schemas/1.9.0",
  });

  return create(ExportTraceServiceRequestSchema, {
    resourceSpans: [mockResourceSpans],
  });
}

describe("OTEL Conversion Functions", () => {
  test("parseOtlpHttpTraces handles OTLP/JSON hex IDs (span + links)", async () => {
    const hexTraceId = "664e67a4c7b9917582df5246701a186a";
    const hexSpanId = "abcdef1234567890";
    const hexLinkTraceId = "a1b2c3d4e5f67890fedcba0987654321";
    const hexLinkSpanId = "1234567890abcdef";

    const jsonBody = {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId: hexTraceId,
                  spanId: hexSpanId,
                  parentSpanId: "",
                  name: "test-span-json",
                  kind: "SPAN_KIND_INTERNAL",
                  startTimeUnixNano: "1640995200000000000",
                  endTimeUnixNano: "1640995200103524564",
                  events: [],
                  links: [
                    {
                      traceId: hexLinkTraceId,
                      spanId: hexLinkSpanId,
                      attributes: [],
                      droppedAttributesCount: 0,
                      flags: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as const;

    const req = new Request("http://localhost/v1/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonBody),
    });

    const parsed = await parseOtlpHttpTraces(req);
    const opts: TraceOptions = {
      agent_id: "agent-json-1",
      deployment_id: "deploy-json-1",
      deployment_target_id: "target-json-1",
    };
    const spans = mapExportTraceServiceRequestToOtelSpans(parsed, opts);
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.payload.span.trace_id).toBe(hexTraceId);
    expect(span.payload.span.id).toBe(hexSpanId);
    expect(span.payload.span.links[0]?.linked_trace_id).toBe(hexLinkTraceId);
    expect(span.payload.span.links[0]?.linked_span_id).toBe(hexLinkSpanId);
  });

  describe("mapExportTraceServiceRequestToOtelSpans", () => {
    test("should convert a basic trace request to OtelSpan array", () => {
      const mockRequest = createMockTraceRequest();
      const options = createMockOptions();

      const result = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        options
      );

      expect(result).toHaveLength(1);

      const span = result[0];
      expect(span.agent_id).toBe(options.agent_id);
      expect(span.payload.span.name).toBe("test-span");
      expect(span.payload.span.kind).toBe("INTERNAL");
      expect(span.payload.span.status_code).toBe("OK");
      expect(span.payload.span.status_message).toBe("Success");
      expect(span.payload.span.trace_id).toBe(
        "a1b2c3d4e5f67890fedcba0987654321"
      );
      expect(span.payload.span.id).toBe("1234567890abcdef");
      expect(span.payload.span.parent_span_id).toBe("fedcba0987654321");
    });

    test("should convert timestamps correctly", () => {
      const mockRequest = createMockTraceRequest();
      const result = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        createMockOptions()
      );

      const span = result[0];
      expect(span.start_time).toBe("2022-01-01 00:00:00.000000000Z");
      expect(span.end_time).toBe("2022-01-01 00:00:01.000000000Z");
      expect(span.payload.span.duration_ns).toBe("1000000000"); // 1 second in nanoseconds
    });

    test("should convert span attributes correctly", () => {
      const mockRequest = createMockTraceRequest();
      const result = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        createMockOptions()
      );

      const span = result[0];
      expect(span.payload.span.attributes).toEqual({
        service: { name: "test-service" },
        span: { kind: "internal" },
      });
    });

    test("should convert resource attributes correctly", () => {
      const mockRequest = createMockTraceRequest();
      const options = createMockOptions();
      const result = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        options
      );

      const span = result[0];
      expect(span.payload.resource.attributes).toEqual({
        service: {
          name: "test-app",
          version: "1.0.0",
        },
        blink: {
          agent_id: options.agent_id,
          deployment_id: options.deployment_id,
          deployment_target_id: options.deployment_target_id,
          run_id: options.run_id,
          step_id: options.step_id,
        },
      });
    });

    test("should add blink object to resource attributes with provided options", () => {
      const customOptions: TraceOptions = {
        agent_id: "custom-agent-999",
        deployment_id: "custom-deploy-888",
        deployment_target_id: "custom-target-555",
        run_id: "custom-run-777",
        step_id: "custom-step-666",
      };

      const mockRequest = createMockTraceRequest();
      const result = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        customOptions
      );

      const span = result[0];
      expect(span.payload.resource.attributes.blink).toEqual({
        agent_id: "custom-agent-999",
        deployment_id: "custom-deploy-888",
        deployment_target_id: "custom-target-555",
        run_id: "custom-run-777",
        step_id: "custom-step-666",
      });
    });

    test("should handle optional runId and stepId in blink object", () => {
      const mockRequest = createMockTraceRequest();

      // Test with only required fields
      const optionsWithoutOptional: TraceOptions = {
        agent_id: "test-agent-123",
        deployment_id: "test-deployment-456",
        deployment_target_id: "test-target-def",
      };

      const resultWithoutOptional = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        optionsWithoutOptional
      );

      const spanWithoutOptional = resultWithoutOptional[0];
      expect(spanWithoutOptional.payload.resource.attributes.blink).toEqual({
        agent_id: "test-agent-123",
        deployment_id: "test-deployment-456",
        deployment_target_id: "test-target-def",
      });

      // Should not have runId or stepId properties
      expect(
        spanWithoutOptional.payload.resource.attributes.blink
      ).not.toHaveProperty("run_id");
      expect(
        spanWithoutOptional.payload.resource.attributes.blink
      ).not.toHaveProperty("step_id");

      // Test with only runId
      const optionsWithRunId: TraceOptions = {
        agent_id: "test-agent-123",
        deployment_id: "test-deployment-456",
        deployment_target_id: "test-target-def",
        run_id: "test-run-789",
      };

      const resultWithRunId = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        optionsWithRunId
      );

      const spanWithRunId = resultWithRunId[0];
      expect(spanWithRunId.payload.resource.attributes.blink).toEqual({
        agent_id: "test-agent-123",
        deployment_id: "test-deployment-456",
        deployment_target_id: "test-target-def",
        run_id: "test-run-789",
      });
      expect(
        spanWithRunId.payload.resource.attributes.blink
      ).not.toHaveProperty("step_id");

      // Test with only stepId
      const optionsWithStepId: TraceOptions = {
        agent_id: "test-agent-123",
        deployment_id: "test-deployment-456",
        deployment_target_id: "test-target-def",
        step_id: "test-step-abc",
      };

      const resultWithStepId = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        optionsWithStepId
      );

      const spanWithStepId = resultWithStepId[0];
      expect(spanWithStepId.payload.resource.attributes.blink).toEqual({
        agent_id: "test-agent-123",
        deployment_id: "test-deployment-456",
        deployment_target_id: "test-target-def",
        step_id: "test-step-abc",
      });
      expect(
        spanWithStepId.payload.resource.attributes.blink
      ).not.toHaveProperty("run_id");
    });

    test("should replace existing blink object in resource attributes", () => {
      const existingBlinkAttr = create(KeyValueSchema, {
        key: "blink",
        value: create(AnyValueSchema, {
          value: {
            case: "kvlistValue",
            value: create(KeyValueListSchema, {
              values: [
                create(KeyValueSchema, {
                  key: "oldAgentId",
                  value: create(AnyValueSchema, {
                    value: { case: "stringValue", value: "old-agent-123" },
                  }),
                }),
                create(KeyValueSchema, {
                  key: "oldDeploymentId",
                  value: create(AnyValueSchema, {
                    value: { case: "stringValue", value: "old-deploy-456" },
                  }),
                }),
              ],
            }),
          },
        }),
      });

      const requestWithExistingBlink = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
            resource: create(ResourceSchema, {
              attributes: [
                createMockAttribute("service.name", "test-app"),
                createMockAttribute("service.version", "1.0.0"),
                existingBlinkAttr, // This should be replaced
              ],
              droppedAttributesCount: 0,
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
                    name: "test-span",
                    kind: Span_SpanKind.INTERNAL,
                    startTimeUnixNano: BigInt("1640995200000000000"),
                    endTimeUnixNano: BigInt("1640995201000000000"),
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const options = createMockOptions();
      const result = mapExportTraceServiceRequestToOtelSpans(
        requestWithExistingBlink,
        options
      );

      const span = result[0];

      // Should have our new blink object, not the old one
      expect(span.payload.resource.attributes.blink).toEqual({
        agent_id: options.agent_id,
        deployment_id: options.deployment_id,
        deployment_target_id: options.deployment_target_id,
        run_id: options.run_id,
        step_id: options.step_id,
      });

      // Should not contain the old blink properties
      expect(span.payload.resource.attributes.blink).not.toHaveProperty(
        "oldAgentId"
      );
      expect(span.payload.resource.attributes.blink).not.toHaveProperty(
        "oldDeploymentId"
      );

      // Other attributes should remain unchanged
      expect(span.payload.resource.attributes).toHaveProperty(
        "service.name",
        "test-app"
      );
      expect(span.payload.resource.attributes).toHaveProperty(
        "service.version",
        "1.0.0"
      );
    });

    test("should convert scope attributes correctly", () => {
      const mockRequest = createMockTraceRequest();
      const result = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        createMockOptions()
      );

      const span = result[0];
      expect(span.payload.scope.attributes).toEqual({
        library: { language: "typescript" },
      });
      expect(span.payload.scope.name).toBe("test-instrumentation");
      expect(span.payload.scope.version).toBe("1.0.0");
    });

    test("should convert events to array of objects", () => {
      const mockRequest = createMockTraceRequest();
      const result = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        createMockOptions()
      );

      const span = result[0];
      expect(span.payload.span.events).toHaveLength(1);
      expect(span.payload.span.events[0]).toEqual({
        time: "2022-01-01 00:00:00.500000000Z",
        name: "test-event",
        dropped_attributes_count: 0,
        attributes: {
          event: { type: "log" },
        },
      });
    });

    test("should convert links to array of objects", () => {
      const mockRequest = createMockTraceRequest();
      const result = mapExportTraceServiceRequestToOtelSpans(
        mockRequest,
        createMockOptions()
      );

      const span = result[0];
      expect(span.payload.span.links).toHaveLength(1);
      expect(span.payload.span.links[0]).toEqual({
        linked_trace_id: "deadbeefcafebabe1234567890abcdef",
        linked_span_id: "cafebabe12345678",
        trace_state: "vendor=test",
        flags: 1,
        dropped_attributes_count: 0,
        attributes: {
          link: { type: "reference" },
        },
      });
    });

    test("should handle empty arrays gracefully", () => {
      const emptyRequest = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
            resource: create(ResourceSchema, {
              attributes: [createMockAttribute("service.name", "test-app")],
              droppedAttributesCount: 0,
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
                    name: "test-span",
                    kind: Span_SpanKind.INTERNAL,
                    startTimeUnixNano: BigInt("1640995200000000000"),
                    endTimeUnixNano: BigInt("1640995201000000000"),
                    events: [], // Empty events
                    links: [], // Empty links
                    attributes: [],
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        emptyRequest,
        createMockOptions()
      );

      const span = result[0];
      expect(span.payload.span.events).toEqual([]);
      expect(span.payload.span.links).toEqual([]);
    });

    test("should handle missing optional fields", () => {
      const minimalRequest = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
            resource: create(ResourceSchema, {
              attributes: [],
            }),
            scopeSpans: [
              create(ScopeSpansSchema, {
                spans: [
                  create(SpanSchema, {
                    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                    spanId: createMockId("1234567890abcdef"),
                    parentSpanId: new Uint8Array(), // Empty parent span ID
                    name: "test-span",
                    kind: Span_SpanKind.INTERNAL,
                    startTimeUnixNano: BigInt("1640995200000000000"),
                    endTimeUnixNano: BigInt("1640995201000000000"),
                    traceState: "", // Empty trace state
                    // No status field - should default to UNSET
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        minimalRequest,
        createMockOptions()
      );

      const resultSpan = result[0];
      expect(resultSpan.payload.span.parent_span_id).toBe("");
      expect(resultSpan.payload.span.trace_state).toBe("");
      expect(resultSpan.payload.span.status_code).toBe("UNSET");
      expect(resultSpan.payload.span.status_message).toBe("");
    });

    test("should handle multiple spans", () => {
      const multiSpanRequest = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
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
                    name: "first-span",
                    kind: Span_SpanKind.INTERNAL,
                    startTimeUnixNano: BigInt("1640995200000000000"),
                    endTimeUnixNano: BigInt("1640995201000000000"),
                  }),
                  create(SpanSchema, {
                    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                    spanId: createMockId("abcdef1234567890"),
                    name: "second-span",
                    kind: Span_SpanKind.SERVER,
                    startTimeUnixNano: BigInt("1640995201000000000"),
                    endTimeUnixNano: BigInt("1640995202000000000"),
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        multiSpanRequest,
        createMockOptions()
      );

      expect(result).toHaveLength(2);
      expect(result[0].payload.span.name).toBe("first-span");
      expect(result[0].payload.span.kind).toBe("INTERNAL");
      expect(result[1].payload.span.name).toBe("second-span");
      expect(result[1].payload.span.kind).toBe("SERVER");
    });

    test("should handle different span kinds", () => {
      const spanKinds = [
        { kind: Span_SpanKind.INTERNAL, expected: "INTERNAL" },
        { kind: Span_SpanKind.SERVER, expected: "SERVER" },
        { kind: Span_SpanKind.CLIENT, expected: "CLIENT" },
        { kind: Span_SpanKind.PRODUCER, expected: "PRODUCER" },
        { kind: Span_SpanKind.CONSUMER, expected: "CONSUMER" },
        { kind: Span_SpanKind.UNSPECIFIED, expected: "UNSPECIFIED" },
      ];

      spanKinds.forEach(({ kind, expected }) => {
        const request = create(ExportTraceServiceRequestSchema, {
          resourceSpans: [
            create(ResourceSpansSchema, {
              scopeSpans: [
                create(ScopeSpansSchema, {
                  spans: [
                    create(SpanSchema, {
                      traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                      spanId: createMockId("1234567890abcdef"),
                      name: "test-span",
                      kind,
                      startTimeUnixNano: BigInt("1640995200000000000"),
                      endTimeUnixNano: BigInt("1640995201000000000"),
                    }),
                  ],
                }),
              ],
            }),
          ],
        });

        const result = mapExportTraceServiceRequestToOtelSpans(
          request,
          createMockOptions()
        );
        expect(result[0].payload.span.kind).toBe(expected);
      });
    });

    test("should handle different status codes", () => {
      const statusCodes = [
        { code: Status_StatusCode.OK, expected: "OK" },
        { code: Status_StatusCode.ERROR, expected: "ERROR" },
        { code: Status_StatusCode.UNSET, expected: "UNSET" },
      ];

      statusCodes.forEach(({ code, expected }) => {
        const request = create(ExportTraceServiceRequestSchema, {
          resourceSpans: [
            create(ResourceSpansSchema, {
              scopeSpans: [
                create(ScopeSpansSchema, {
                  spans: [
                    create(SpanSchema, {
                      traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                      spanId: createMockId("1234567890abcdef"),
                      name: "test-span",
                      kind: Span_SpanKind.INTERNAL,
                      startTimeUnixNano: BigInt("1640995200000000000"),
                      endTimeUnixNano: BigInt("1640995201000000000"),
                      status: create(StatusSchema, {
                        code,
                        message: "Test message",
                      }),
                    }),
                  ],
                }),
              ],
            }),
          ],
        });

        const result = mapExportTraceServiceRequestToOtelSpans(
          request,
          createMockOptions()
        );
        expect(result[0].payload.span.status_code).toBe(expected);
        expect(result[0].payload.span.status_message).toBe("Test message");
      });
    });

    test("should handle empty trace request", () => {
      const emptyRequest = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        emptyRequest,
        createMockOptions()
      );
      expect(result).toEqual([]);
    });

    test("should calculate duration correctly", () => {
      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
            scopeSpans: [
              create(ScopeSpansSchema, {
                spans: [
                  create(SpanSchema, {
                    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                    spanId: createMockId("1234567890abcdef"),
                    name: "test-span",
                    startTimeUnixNano: BigInt("1640995200000000000"),
                    endTimeUnixNano: BigInt("1640995200000000000"), // Same time = 0 duration
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        request,
        createMockOptions()
      );
      expect(result[0].payload.span.duration_ns).toBe("0");
    });

    test("should handle negative duration by returning 0", () => {
      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
            scopeSpans: [
              create(ScopeSpansSchema, {
                spans: [
                  create(SpanSchema, {
                    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                    spanId: createMockId("1234567890abcdef"),
                    name: "test-span",
                    startTimeUnixNano: BigInt("1640995202000000000"), // End before start
                    endTimeUnixNano: BigInt("1640995200000000000"),
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        request,
        createMockOptions()
      );
      expect(result[0].payload.span.duration_ns).toBe("0");
    });

    test("should convert different attribute value types correctly", () => {
      // Helper to create AnyValue with different types
      const createStringAttr = (key: string, value: string) =>
        create(KeyValueSchema, {
          key,
          value: create(AnyValueSchema, {
            value: { case: "stringValue", value },
          }),
        });

      const createBoolAttr = (key: string, value: boolean) =>
        create(KeyValueSchema, {
          key,
          value: create(AnyValueSchema, {
            value: { case: "boolValue", value },
          }),
        });

      const createIntAttr = (key: string, value: bigint) =>
        create(KeyValueSchema, {
          key,
          value: create(AnyValueSchema, {
            value: { case: "intValue", value },
          }),
        });

      const createDoubleAttr = (key: string, value: number) =>
        create(KeyValueSchema, {
          key,
          value: create(AnyValueSchema, {
            value: { case: "doubleValue", value },
          }),
        });

      const createBytesAttr = (key: string, bytes: Uint8Array) =>
        create(KeyValueSchema, {
          key,
          value: create(AnyValueSchema, {
            value: { case: "bytesValue", value: bytes },
          }),
        });

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
            scopeSpans: [
              create(ScopeSpansSchema, {
                spans: [
                  create(SpanSchema, {
                    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                    spanId: createMockId("1234567890abcdef"),
                    name: "test-span",
                    kind: Span_SpanKind.INTERNAL,
                    startTimeUnixNano: BigInt("1640995200000000000"),
                    endTimeUnixNano: BigInt("1640995201000000000"),
                    attributes: [
                      createStringAttr("str_attr", "hello world"),
                      createStringAttr("empty_str", ""),
                      createStringAttr("unicode", "🚀 测试"),
                      createBoolAttr("bool_true", true),
                      createBoolAttr("bool_false", false),
                      createIntAttr("small_int", BigInt(42)),
                      createIntAttr("large_int", BigInt("9007199254740992")), // Larger than MAX_SAFE_INTEGER
                      createIntAttr("negative_int", BigInt(-123)),
                      createDoubleAttr("double_val", 3.14159),
                      createDoubleAttr("negative_double", -2.718),
                      createDoubleAttr("zero_double", 0.0),
                      createDoubleAttr("inf_double", Infinity),
                      createDoubleAttr("neg_inf_double", -Infinity),
                      createBytesAttr(
                        "bytes_attr",
                        new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])
                      ), // "Hello"
                      createBytesAttr("empty_bytes", new Uint8Array()),
                      createBytesAttr(
                        "binary_data",
                        new Uint8Array([0x00, 0x01, 0xff, 0xab, 0xcd])
                      ),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        request,
        createMockOptions()
      );
      const attrs = result[0].payload.span.attributes;

      // String values
      expect(attrs["str_attr"]).toBe("hello world");
      expect(attrs["empty_str"]).toBe("");
      expect(attrs["unicode"]).toBe("🚀 测试");

      // Boolean values
      expect(attrs["bool_true"]).toBe(true);
      expect(attrs["bool_false"]).toBe(false);

      // Integer values
      expect(attrs["small_int"]).toBe(42);
      expect(attrs["large_int"]).toBe("9007199254740992"); // Should be string for large numbers
      expect(attrs["negative_int"]).toBe(-123);

      // Double values
      expect(attrs["double_val"]).toBe(3.14159);
      expect(attrs["negative_double"]).toBe(-2.718);
      expect(attrs["zero_double"]).toBe(0.0);
      expect(attrs["inf_double"]).toBe(Infinity);
      expect(attrs["neg_inf_double"]).toBe(-Infinity);

      // Bytes values (should be base64 encoded)
      expect(attrs["bytes_attr"]).toBe("SGVsbG8="); // "Hello" in base64
      expect(attrs["empty_bytes"]).toBe(""); // Empty bytes should be empty string
      expect(attrs["binary_data"]).toBe("AAH/q80="); // Binary data in base64
    });

    test("should handle array and nested object attributes", () => {
      // Create array attribute
      const createArrayAttr = (key: string, values: any[]) =>
        create(KeyValueSchema, {
          key,
          value: create(AnyValueSchema, {
            value: {
              case: "arrayValue",
              value: create(ArrayValueSchema, {
                values: values.map((v) =>
                  typeof v === "string"
                    ? create(AnyValueSchema, {
                        value: { case: "stringValue", value: v },
                      })
                    : typeof v === "number"
                      ? create(AnyValueSchema, {
                          value: { case: "doubleValue", value: v },
                        })
                      : typeof v === "boolean"
                        ? create(AnyValueSchema, {
                            value: { case: "boolValue", value: v },
                          })
                        : create(AnyValueSchema, {
                            value: { case: "stringValue", value: String(v) },
                          })
                ),
              }),
            },
          }),
        });

      // Create nested object attribute
      const createObjectAttr = (key: string, obj: Record<string, string>) =>
        create(KeyValueSchema, {
          key,
          value: create(AnyValueSchema, {
            value: {
              case: "kvlistValue",
              value: create(KeyValueListSchema, {
                values: Object.entries(obj).map(([k, v]) =>
                  create(KeyValueSchema, {
                    key: k,
                    value: create(AnyValueSchema, {
                      value: { case: "stringValue", value: v },
                    }),
                  })
                ),
              }),
            },
          }),
        });

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
            scopeSpans: [
              create(ScopeSpansSchema, {
                spans: [
                  create(SpanSchema, {
                    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                    spanId: createMockId("1234567890abcdef"),
                    name: "test-span",
                    kind: Span_SpanKind.INTERNAL,
                    startTimeUnixNano: BigInt("1640995200000000000"),
                    endTimeUnixNano: BigInt("1640995201000000000"),
                    attributes: [
                      createArrayAttr("string_array", ["one", "two", "three"]),
                      createArrayAttr("mixed_array", ["string", 42, true]),
                      createArrayAttr("empty_array", []),
                      createObjectAttr("nested_obj", {
                        inner_key1: "value1",
                        inner_key2: "value2",
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        request,
        createMockOptions()
      );
      const attrs = result[0].payload.span.attributes;

      // Array attributes
      expect(attrs["string_array"]).toEqual(["one", "two", "three"]);
      expect(attrs["mixed_array"]).toEqual(["string", 42, true]);
      expect(attrs["empty_array"]).toEqual([]);

      // Nested object attributes
      expect(attrs["nested_obj"]).toEqual({
        inner_key1: "value1",
        inner_key2: "value2",
      });
    });

    test("should handle null and undefined attribute values", () => {
      // Create attribute with undefined value
      const createNullAttr = (key: string) =>
        create(KeyValueSchema, {
          key,
          value: undefined, // This should result in null
        });

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
            scopeSpans: [
              create(ScopeSpansSchema, {
                spans: [
                  create(SpanSchema, {
                    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                    spanId: createMockId("1234567890abcdef"),
                    name: "test-span",
                    kind: Span_SpanKind.INTERNAL,
                    startTimeUnixNano: BigInt("1640995200000000000"),
                    endTimeUnixNano: BigInt("1640995201000000000"),
                    attributes: [
                      createNullAttr("null_attr"),
                      // Empty key should be filtered out
                      create(KeyValueSchema, {
                        key: "",
                        value: create(AnyValueSchema, {
                          value: {
                            case: "stringValue",
                            value: "should_be_filtered",
                          },
                        }),
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        request,
        createMockOptions()
      );
      const attrs = result[0].payload.span.attributes;

      // Should handle null/undefined values
      expect(attrs["null_attr"]).toBe(null);

      // Empty keys should be filtered out
      expect(attrs[""]).toBeUndefined();
      expect(Object.keys(attrs)).not.toContain("");
    });

    test("should handle extremely large numbers and edge cases", () => {
      const createIntAttr = (key: string, value: bigint) =>
        create(KeyValueSchema, {
          key,
          value: create(AnyValueSchema, {
            value: { case: "intValue", value },
          }),
        });

      const createDoubleAttr = (key: string, value: number) =>
        create(KeyValueSchema, {
          key,
          value: create(AnyValueSchema, {
            value: { case: "doubleValue", value },
          }),
        });

      const request = create(ExportTraceServiceRequestSchema, {
        resourceSpans: [
          create(ResourceSpansSchema, {
            scopeSpans: [
              create(ScopeSpansSchema, {
                spans: [
                  create(SpanSchema, {
                    traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                    spanId: createMockId("1234567890abcdef"),
                    name: "test-span",
                    kind: Span_SpanKind.INTERNAL,
                    startTimeUnixNano: BigInt("1640995200000000000"),
                    endTimeUnixNano: BigInt("1640995201000000000"),
                    attributes: [
                      // Edge cases for integers
                      createIntAttr(
                        "max_safe_int",
                        BigInt(Number.MAX_SAFE_INTEGER)
                      ),
                      createIntAttr(
                        "max_safe_int_plus_one",
                        BigInt(Number.MAX_SAFE_INTEGER + 1)
                      ),
                      createIntAttr(
                        "min_safe_int",
                        BigInt(Number.MIN_SAFE_INTEGER)
                      ),
                      createIntAttr(
                        "min_safe_int_minus_one",
                        BigInt(Number.MIN_SAFE_INTEGER - 1)
                      ),
                      createIntAttr(
                        "very_large_positive",
                        BigInt("18446744073709551615")
                      ), // 2^64-1
                      createIntAttr(
                        "very_large_negative",
                        BigInt("-18446744073709551615")
                      ),

                      // Edge cases for doubles
                      createDoubleAttr("nan_double", NaN),
                      createDoubleAttr("max_value", Number.MAX_VALUE),
                      createDoubleAttr("min_value", Number.MIN_VALUE),
                      createDoubleAttr("epsilon", Number.EPSILON),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportTraceServiceRequestToOtelSpans(
        request,
        createMockOptions()
      );
      const attrs = result[0].payload.span.attributes;

      // Safe integers should remain as numbers
      expect(attrs["max_safe_int"]).toBe(Number.MAX_SAFE_INTEGER);
      expect(attrs["min_safe_int"]).toBe(Number.MIN_SAFE_INTEGER);

      // Unsafe integers should become strings
      expect(attrs["max_safe_int_plus_one"]).toBe(
        (Number.MAX_SAFE_INTEGER + 1).toString()
      );
      expect(attrs["min_safe_int_minus_one"]).toBe(
        (Number.MIN_SAFE_INTEGER - 1).toString()
      );
      expect(attrs["very_large_positive"]).toBe("18446744073709551615");
      expect(attrs["very_large_negative"]).toBe("-18446744073709551615");

      // Special double values
      expect(Number.isNaN(attrs["nan_double"])).toBe(true);
      expect(attrs["max_value"]).toBe(Number.MAX_VALUE);
      expect(attrs["min_value"]).toBe(Number.MIN_VALUE);
      expect(attrs["epsilon"]).toBe(Number.EPSILON);
    });
  });
});

describe("Per-span blink ID extraction", () => {
  // Helper to create a blink ID attribute
  function createBlinkIdAttribute(key: string, value: string) {
    return create(KeyValueSchema, {
      key: `blink.${key}`,
      value: create(AnyValueSchema, {
        value: { case: "stringValue", value },
      }),
    });
  }

  // Helper to create a trace request with custom span attributes
  function createRequestWithSpanAttributes(
    attributes: ReturnType<typeof create<typeof KeyValueSchema>>[]
  ) {
    return create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        create(ResourceSpansSchema, {
          resource: create(ResourceSchema, {
            attributes: [createMockAttribute("service.name", "test-app")],
          }),
          scopeSpans: [
            create(ScopeSpansSchema, {
              scope: create(InstrumentationScopeSchema, {
                name: "test-instrumentation",
              }),
              spans: [
                create(SpanSchema, {
                  traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                  spanId: createMockId("1234567890abcdef"),
                  name: "test-span",
                  kind: Span_SpanKind.INTERNAL,
                  startTimeUnixNano: BigInt("1640995200000000000"),
                  endTimeUnixNano: BigInt("1640995201000000000"),
                  attributes,
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  // Helper to create a ResourceSpans with blink IDs in span attributes
  function createResourceSpansWithBlinkIds(
    blinkIds: { run_id?: string; step_id?: string; chat_id?: string },
    spanName: string
  ) {
    const spanAttributes: ReturnType<typeof create<typeof KeyValueSchema>>[] =
      [];
    if (blinkIds.run_id) {
      spanAttributes.push(createBlinkIdAttribute("run_id", blinkIds.run_id));
    }
    if (blinkIds.step_id) {
      spanAttributes.push(createBlinkIdAttribute("step_id", blinkIds.step_id));
    }
    if (blinkIds.chat_id) {
      spanAttributes.push(createBlinkIdAttribute("chat_id", blinkIds.chat_id));
    }

    return create(ResourceSpansSchema, {
      resource: create(ResourceSchema, {
        attributes: [createMockAttribute("service.name", "test-app")],
      }),
      scopeSpans: [
        create(ScopeSpansSchema, {
          scope: create(InstrumentationScopeSchema, {
            name: "test-instrumentation",
          }),
          spans: [
            create(SpanSchema, {
              traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
              spanId: createMockId("1234567890abcdef"),
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

  test("should extract IDs from each span's attributes when options IDs are undefined", () => {
    // Create a request with two spans, each with different blink IDs in their attributes
    const request = create(ExportTraceServiceRequestSchema, {
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

    // Options without IDs - should extract from each resource
    const options: TraceOptions = {
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
      // run_id, step_id, chat_id are undefined
    };

    const result = mapExportTraceServiceRequestToOtelSpans(request, options);

    expect(result).toHaveLength(2);

    // First span should have first resource's IDs
    expect(result[0].payload.span.name).toBe("first-span");
    expect(result[0].payload.resource.attributes.blink).toEqual({
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
      run_id: "first-run-id",
      step_id: "first-step-id",
      chat_id: "first-chat-id",
    });

    // Second span should have second resource's IDs
    expect(result[1].payload.span.name).toBe("second-span");
    expect(result[1].payload.resource.attributes.blink).toEqual({
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
      run_id: "second-run-id",
      step_id: "second-step-id",
      chat_id: "second-chat-id",
    });
  });

  test("should use options IDs when provided (not extract from span)", () => {
    // Create a request with blink IDs in the span
    const request = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        createResourceSpansWithBlinkIds(
          { run_id: "resource-run-id", step_id: "resource-step-id" },
          "test-span"
        ),
      ],
    });

    // Options with IDs - should use these, not extract from resource
    const options: TraceOptions = {
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
      run_id: "options-run-id",
      step_id: "options-step-id",
      chat_id: "options-chat-id",
    };

    const result = mapExportTraceServiceRequestToOtelSpans(request, options);

    expect(result).toHaveLength(1);
    expect(result[0].payload.resource.attributes.blink).toEqual({
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
      run_id: "options-run-id",
      step_id: "options-step-id",
      chat_id: "options-chat-id",
    });
  });

  test("should handle partial options IDs (some from options, some from span)", () => {
    // Create a request with blink IDs in the span
    const request = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        createResourceSpansWithBlinkIds(
          {
            run_id: "span-run-id",
            step_id: "span-step-id",
            chat_id: "span-chat-id",
          },
          "test-span"
        ),
      ],
    });

    // Options with only run_id - step_id and chat_id should come from span
    const options: TraceOptions = {
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
      run_id: "options-run-id",
      // step_id and chat_id are undefined
    };

    const result = mapExportTraceServiceRequestToOtelSpans(request, options);

    expect(result).toHaveLength(1);
    expect(result[0].payload.resource.attributes.blink).toEqual({
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
      run_id: "options-run-id",
      step_id: "span-step-id",
      chat_id: "span-chat-id",
    });
  });

  test("should remove only blink ID keys from span attributes, preserving other blink attributes", () => {
    const request = createRequestWithSpanAttributes([
      createBlinkIdAttribute("run_id", "extracted-run-id"),
      createBlinkIdAttribute("step_id", "extracted-step-id"),
      createBlinkIdAttribute("chat_id", "extracted-chat-id"),
      // Other blink attributes that should be preserved
      createBlinkIdAttribute("custom_field", "custom-value"),
      create(KeyValueSchema, {
        key: "blink.another_field",
        value: create(AnyValueSchema, {
          value: { case: "intValue", value: BigInt(42) },
        }),
      }),
      // Other non-blink attributes
      createMockAttribute("http.method", "GET"),
      createMockAttribute("http.url", "https://example.com"),
    ]);

    const options: TraceOptions = {
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
    };

    const result = mapExportTraceServiceRequestToOtelSpans(request, options);
    expect(result).toHaveLength(1);

    const spanAttrs = result[0].payload.span.attributes;

    // Verify blink ID keys are removed
    expect(spanAttrs).not.toHaveProperty("blink.run_id");
    expect(spanAttrs).not.toHaveProperty("blink.step_id");
    expect(spanAttrs).not.toHaveProperty("blink.chat_id");

    // Verify other blink attributes are preserved
    expect(spanAttrs).toHaveProperty("blink.custom_field", "custom-value");
    expect(spanAttrs).toHaveProperty("blink.another_field", 42);

    // Verify other non-blink attributes are preserved
    expect(spanAttrs).toHaveProperty("http.method", "GET");
    expect(spanAttrs).toHaveProperty("http.url", "https://example.com");

    // Verify the IDs were moved to resource.attributes.blink
    expect(result[0].payload.resource.attributes.blink).toEqual({
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
      run_id: "extracted-run-id",
      step_id: "extracted-step-id",
      chat_id: "extracted-chat-id",
    });
  });

  test("should remove blink object entirely when it only contains ID keys", () => {
    const request = createRequestWithSpanAttributes([
      createBlinkIdAttribute("run_id", "extracted-run-id"),
      createBlinkIdAttribute("step_id", "extracted-step-id"),
      createMockAttribute("http.method", "GET"),
    ]);

    const options: TraceOptions = {
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
    };

    const result = mapExportTraceServiceRequestToOtelSpans(request, options);

    expect(result).toHaveLength(1);

    const spanAttrs = result[0].payload.span.attributes;

    // Verify blink object is completely removed (it only had ID fields)
    expect(spanAttrs).not.toHaveProperty("blink");

    // Verify other attributes are preserved
    expect(spanAttrs).toHaveProperty("http.method", "GET");
  });

  test("should handle span without blink attributes when options IDs are undefined", () => {
    // Create a request without blink IDs in the span
    const request = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        create(ResourceSpansSchema, {
          resource: create(ResourceSchema, {
            attributes: [createMockAttribute("service.name", "test-app")],
          }),
          scopeSpans: [
            create(ScopeSpansSchema, {
              spans: [
                create(SpanSchema, {
                  traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                  spanId: createMockId("1234567890abcdef"),
                  name: "test-span",
                  kind: Span_SpanKind.INTERNAL,
                  startTimeUnixNano: BigInt("1640995200000000000"),
                  endTimeUnixNano: BigInt("1640995201000000000"),
                }),
              ],
            }),
          ],
        }),
      ],
    });

    // Options without IDs
    const options: TraceOptions = {
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
    };

    const result = mapExportTraceServiceRequestToOtelSpans(request, options);

    expect(result).toHaveLength(1);
    // Should not have run_id, step_id, chat_id
    expect(result[0].payload.resource.attributes.blink).toEqual({
      agent_id: "test-agent-123",
      deployment_id: "test-deployment-456",
      deployment_target_id: "test-target-789",
    });
    expect(result[0].payload.resource.attributes.blink).not.toHaveProperty(
      "run_id"
    );
    expect(result[0].payload.resource.attributes.blink).not.toHaveProperty(
      "step_id"
    );
    expect(result[0].payload.resource.attributes.blink).not.toHaveProperty(
      "chat_id"
    );
  });
});

describe("Prototype pollution prevention", () => {
  test("should skip __proto__ as a single-segment key", () => {
    const request = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        create(ResourceSpansSchema, {
          scopeSpans: [
            create(ScopeSpansSchema, {
              spans: [
                create(SpanSchema, {
                  traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                  spanId: createMockId("1234567890abcdef"),
                  name: "test-span",
                  kind: Span_SpanKind.INTERNAL,
                  startTimeUnixNano: BigInt("1640995200000000000"),
                  endTimeUnixNano: BigInt("1640995201000000000"),
                  attributes: [
                    createMockAttribute("__proto__", "malicious"),
                    createMockAttribute("constructor", "malicious"),
                    createMockAttribute("prototype", "malicious"),
                    createMockAttribute("safe_key", "safe_value"),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = mapExportTraceServiceRequestToOtelSpans(
      request,
      createMockOptions()
    );

    const attrs = result[0].payload.span.attributes;

    // Dangerous keys should be skipped (use Object.hasOwn to check own properties)
    expect(Object.hasOwn(attrs, "__proto__")).toBe(false);
    expect(Object.hasOwn(attrs, "constructor")).toBe(false);
    expect(Object.hasOwn(attrs, "prototype")).toBe(false);

    // Safe key should be present
    expect(attrs["safe_key"]).toBe("safe_value");

    // Object.prototype should not be polluted
    expect(({} as any).malicious).toBeUndefined();
  });

  test("should skip keys with __proto__ as an intermediate segment", () => {
    const request = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        create(ResourceSpansSchema, {
          scopeSpans: [
            create(ScopeSpansSchema, {
              spans: [
                create(SpanSchema, {
                  traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                  spanId: createMockId("1234567890abcdef"),
                  name: "test-span",
                  kind: Span_SpanKind.INTERNAL,
                  startTimeUnixNano: BigInt("1640995200000000000"),
                  endTimeUnixNano: BigInt("1640995201000000000"),
                  attributes: [
                    createMockAttribute("foo.__proto__.polluted", "malicious"),
                    createMockAttribute(
                      "bar.constructor.polluted",
                      "malicious"
                    ),
                    createMockAttribute("baz.prototype.polluted", "malicious"),
                    createMockAttribute("safe.nested.key", "safe_value"),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = mapExportTraceServiceRequestToOtelSpans(
      request,
      createMockOptions()
    );

    const attrs = result[0].payload.span.attributes;

    // The first segment may be created but the dangerous property should not be traversed
    // Most importantly, Object.prototype should not be polluted
    expect(({} as any).polluted).toBeUndefined();

    // Safe nested key should be present
    expect((attrs["safe"] as any)?.["nested"]?.["key"]).toBe("safe_value");
  });

  test("should skip keys with __proto__ as the final segment", () => {
    const request = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        create(ResourceSpansSchema, {
          scopeSpans: [
            create(ScopeSpansSchema, {
              spans: [
                create(SpanSchema, {
                  traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                  spanId: createMockId("1234567890abcdef"),
                  name: "test-span",
                  kind: Span_SpanKind.INTERNAL,
                  startTimeUnixNano: BigInt("1640995200000000000"),
                  endTimeUnixNano: BigInt("1640995201000000000"),
                  attributes: [
                    createMockAttribute("foo.__proto__", "malicious"),
                    createMockAttribute("bar.constructor", "malicious"),
                    createMockAttribute("baz.prototype", "malicious"),
                    createMockAttribute("safe.key", "safe_value"),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const result = mapExportTraceServiceRequestToOtelSpans(
      request,
      createMockOptions()
    );

    const attrs = result[0].payload.span.attributes;

    // Parent objects may be created, but the dangerous final key should not be set as own property
    if (attrs["foo"]) {
      expect(Object.hasOwn(attrs["foo"] as object, "__proto__")).toBe(false);
    }
    if (attrs["bar"]) {
      expect(Object.hasOwn(attrs["bar"] as object, "constructor")).toBe(false);
    }
    if (attrs["baz"]) {
      expect(Object.hasOwn(attrs["baz"] as object, "prototype")).toBe(false);
    }

    // Safe nested key should be present
    expect((attrs["safe"] as any)?.["key"]).toBe("safe_value");

    // Object.prototype should not be polluted
    expect(({} as any).malicious).toBeUndefined();
  });

  test("should not pollute Object.prototype when processing malicious OTLP payload", () => {
    // Store original prototype state
    const originalProtoKeys = Object.keys(Object.prototype);

    const request = create(ExportTraceServiceRequestSchema, {
      resourceSpans: [
        create(ResourceSpansSchema, {
          scopeSpans: [
            create(ScopeSpansSchema, {
              spans: [
                create(SpanSchema, {
                  traceId: createMockId("a1b2c3d4e5f67890fedcba0987654321"),
                  spanId: createMockId("1234567890abcdef"),
                  name: "test-span",
                  kind: Span_SpanKind.INTERNAL,
                  startTimeUnixNano: BigInt("1640995200000000000"),
                  endTimeUnixNano: BigInt("1640995201000000000"),
                  attributes: [
                    createMockAttribute("__proto__.isAdmin", "true"),
                    createMockAttribute("constructor.prototype.pwned", "yes"),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    mapExportTraceServiceRequestToOtelSpans(request, createMockOptions());

    // Verify Object.prototype was not modified
    expect(Object.keys(Object.prototype)).toEqual(originalProtoKeys);
    expect(({} as any).isAdmin).toBeUndefined();
    expect(({} as any).pwned).toBeUndefined();
  });
});

function createMockLogOptions(): LogOptions {
  return {
    agent_id: "test-agent-123",
    deployment_id: "test-deployment-456",
    deployment_target_id: "test-target-def",
  };
}

// Helper function to create mock ExportLogsServiceRequest
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

describe("OTEL Logs Conversion Functions", () => {
  describe("parseOtlpHttpLogs", () => {
    test("should parse protobuf logs request", async () => {
      const mockRequest = createMockLogsRequest();
      const binaryData = toBinary(ExportLogsServiceRequestSchema, mockRequest);

      const req = new Request("http://localhost/v1/logs", {
        method: "POST",
        headers: { "Content-Type": "application/x-protobuf" },
        body: binaryData,
      });

      const parsed = await parseOtlpHttpLogs(req);
      expect(parsed.resourceLogs).toHaveLength(1);
      expect(parsed.resourceLogs[0].scopeLogs).toHaveLength(1);
      expect(parsed.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(1);
    });

    test("should parse JSON logs request with hex IDs", async () => {
      const hexTraceId = "664e67a4c7b9917582df5246701a186a";
      const hexSpanId = "abcdef1234567890";

      const jsonBody = {
        resourceLogs: [
          {
            resource: { attributes: [] },
            scopeLogs: [
              {
                scope: {},
                logRecords: [
                  {
                    timeUnixNano: "1640995200000000000",
                    severityNumber: 9,
                    severityText: "INFO",
                    body: { stringValue: "Test message" },
                    attributes: [],
                    traceId: hexTraceId,
                    spanId: hexSpanId,
                  },
                ],
              },
            ],
          },
        ],
      };

      const req = new Request("http://localhost/v1/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jsonBody),
      });

      const parsed = await parseOtlpHttpLogs(req);
      const opts = createMockLogOptions();
      const events = mapExportLogsServiceRequestToLogEvents(parsed, opts);

      expect(events).toHaveLength(1);
      expect(events[0].event).toEqual({ message: "Test message" });
    });

    test("should throw on unsupported content type", async () => {
      const req = new Request("http://localhost/v1/logs", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "test",
      });

      await expect(parseOtlpHttpLogs(req)).rejects.toThrow(
        "Unsupported Content-Type"
      );
    });
  });

  describe("mapExportLogsServiceRequestToLogEvents", () => {
    test("should convert a basic log request to OtelLogEvent array", () => {
      const mockRequest = createMockLogsRequest();
      const options = createMockLogOptions();

      const result = mapExportLogsServiceRequestToLogEvents(
        mockRequest,
        options
      );

      expect(result).toHaveLength(1);

      const logEvent = result[0];
      expect(logEvent.agent_id).toBe(options.agent_id);
      expect(logEvent.event).toEqual({
        message: "This is a test log message",
      });
    });

    test("should handle empty log request", () => {
      const emptyRequest = create(ExportLogsServiceRequestSchema, {
        resourceLogs: [],
      });

      const result = mapExportLogsServiceRequestToLogEvents(
        emptyRequest,
        createMockLogOptions()
      );
      expect(result).toEqual([]);
    });

    test("should handle multiple log records", () => {
      const mockLogRecord1 = create(LogRecordSchema, {
        timeUnixNano: BigInt("1640995200000000000"),
        severityNumber: SeverityNumber.INFO,
        body: create(AnyValueSchema, {
          value: { case: "stringValue", value: "First log message" },
        }),
      });

      const mockLogRecord2 = create(LogRecordSchema, {
        timeUnixNano: BigInt("1640995201000000000"),
        severityNumber: SeverityNumber.ERROR,
        body: create(AnyValueSchema, {
          value: { case: "stringValue", value: "Second log message" },
        }),
      });

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
                  version: "1.0.0",
                }),
                logRecords: [mockLogRecord1, mockLogRecord2],
              }),
            ],
          }),
        ],
      });

      const result = mapExportLogsServiceRequestToLogEvents(
        multiLogRequest,
        createMockLogOptions()
      );

      expect(result).toHaveLength(2);
      expect(result[0].event).toEqual({ message: "First log message" });
      expect(result[1].event).toEqual({ message: "Second log message" });
    });

    test("should handle structured body (kvlist)", () => {
      const structuredBody = create(AnyValueSchema, {
        value: {
          case: "kvlistValue",
          value: create(KeyValueListSchema, {
            values: [
              create(KeyValueSchema, {
                key: "error_code",
                value: create(AnyValueSchema, {
                  value: { case: "intValue", value: BigInt(500) },
                }),
              }),
              create(KeyValueSchema, {
                key: "error_message",
                value: create(AnyValueSchema, {
                  value: {
                    case: "stringValue",
                    value: "Internal Server Error",
                  },
                }),
              }),
            ],
          }),
        },
      });

      const request = create(ExportLogsServiceRequestSchema, {
        resourceLogs: [
          create(ResourceLogsSchema, {
            scopeLogs: [
              create(ScopeLogsSchema, {
                logRecords: [
                  create(LogRecordSchema, {
                    timeUnixNano: BigInt("1640995200000000000"),
                    severityNumber: SeverityNumber.ERROR,
                    body: structuredBody,
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportLogsServiceRequestToLogEvents(
        request,
        createMockLogOptions()
      );

      expect(result[0].event).toEqual({
        error_code: 500,
        error_message: "Internal Server Error",
      });
    });

    test("should handle array body", () => {
      const arrayBody = create(AnyValueSchema, {
        value: {
          case: "arrayValue",
          value: create(ArrayValueSchema, {
            values: [
              create(AnyValueSchema, {
                value: { case: "stringValue", value: "item1" },
              }),
              create(AnyValueSchema, {
                value: { case: "stringValue", value: "item2" },
              }),
              create(AnyValueSchema, {
                value: { case: "intValue", value: BigInt(3) },
              }),
            ],
          }),
        },
      });

      const request = create(ExportLogsServiceRequestSchema, {
        resourceLogs: [
          create(ResourceLogsSchema, {
            scopeLogs: [
              create(ScopeLogsSchema, {
                logRecords: [
                  create(LogRecordSchema, {
                    timeUnixNano: BigInt("1640995200000000000"),
                    severityNumber: SeverityNumber.INFO,
                    body: arrayBody,
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportLogsServiceRequestToLogEvents(
        request,
        createMockLogOptions()
      );

      expect(result[0].event).toEqual({
        message: ["item1", "item2", 3],
      });
    });

    test("should spread message object into payload root when message is a plain object", () => {
      // This tests the case where the log body has a message field that is itself an object
      // The message object should be spread into the root, with other fields overlaid
      const structuredBody = create(AnyValueSchema, {
        value: {
          case: "kvlistValue",
          value: create(KeyValueListSchema, {
            values: [
              create(KeyValueSchema, {
                key: "message",
                value: create(AnyValueSchema, {
                  value: {
                    case: "kvlistValue",
                    value: create(KeyValueListSchema, {
                      values: [
                        create(KeyValueSchema, {
                          key: "inner_field",
                          value: create(AnyValueSchema, {
                            value: {
                              case: "stringValue",
                              value: "inner_value",
                            },
                          }),
                        }),
                        create(KeyValueSchema, {
                          key: "another_field",
                          value: create(AnyValueSchema, {
                            value: {
                              case: "stringValue",
                              value: "will_be_overridden",
                            },
                          }),
                        }),
                      ],
                    }),
                  },
                }),
              }),
              create(KeyValueSchema, {
                key: "another_field",
                value: create(AnyValueSchema, {
                  value: { case: "stringValue", value: "outer_value" },
                }),
              }),
              create(KeyValueSchema, {
                key: "trace_id",
                value: create(AnyValueSchema, {
                  value: { case: "stringValue", value: "abc123" },
                }),
              }),
            ],
          }),
        },
      });

      const request = create(ExportLogsServiceRequestSchema, {
        resourceLogs: [
          create(ResourceLogsSchema, {
            scopeLogs: [
              create(ScopeLogsSchema, {
                logRecords: [
                  create(LogRecordSchema, {
                    observedTimeUnixNano: BigInt("1768223454388863471"),
                    body: structuredBody,
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportLogsServiceRequestToLogEvents(
        request,
        createMockLogOptions()
      );

      expect(result[0].event).toEqual({
        inner_field: "inner_value",
        another_field: "outer_value", // outer value overrides inner
        trace_id: "abc123",
      });
    });

    test("should handle JSON-parsed structured log body with message, trace_id, span_id", () => {
      // This reproduces the case where the OTEL collector parses a JSON log line like:
      // {"message":"Web search is not configured...","trace_id":"1b84934b471492df10e60c98c0aad32e","span_id":"8d1e5be733127f29"}
      const structuredBody = create(AnyValueSchema, {
        value: {
          case: "kvlistValue",
          value: create(KeyValueListSchema, {
            values: [
              create(KeyValueSchema, {
                key: "message",
                value: create(AnyValueSchema, {
                  value: {
                    case: "stringValue",
                    value:
                      "Web search is not configured. The `exaApiKey` config field is undefined.",
                  },
                }),
              }),
              create(KeyValueSchema, {
                key: "trace_id",
                value: create(AnyValueSchema, {
                  value: {
                    case: "stringValue",
                    value: "1b84934b471492df10e60c98c0aad32e",
                  },
                }),
              }),
              create(KeyValueSchema, {
                key: "span_id",
                value: create(AnyValueSchema, {
                  value: {
                    case: "stringValue",
                    value: "8d1e5be733127f29",
                  },
                }),
              }),
            ],
          }),
        },
      });

      const request = create(ExportLogsServiceRequestSchema, {
        resourceLogs: [
          create(ResourceLogsSchema, {
            scopeLogs: [
              create(ScopeLogsSchema, {
                logRecords: [
                  create(LogRecordSchema, {
                    observedTimeUnixNano: BigInt("1768223454388863471"),
                    body: structuredBody,
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportLogsServiceRequestToLogEvents(
        request,
        createMockLogOptions()
      );

      expect(result[0].event).toEqual({
        message:
          "Web search is not configured. The `exaApiKey` config field is undefined.",
        trace_id: "1b84934b471492df10e60c98c0aad32e",
        span_id: "8d1e5be733127f29",
      });
    });

    test("should handle missing optional fields", () => {
      const minimalRequest = create(ExportLogsServiceRequestSchema, {
        resourceLogs: [
          create(ResourceLogsSchema, {
            resource: create(ResourceSchema, {
              attributes: [],
            }),
            scopeLogs: [
              create(ScopeLogsSchema, {
                logRecords: [
                  create(LogRecordSchema, {
                    timeUnixNano: BigInt("1640995200000000000"),
                    // No body, no attributes, no trace/span ids
                  }),
                ],
              }),
            ],
          }),
        ],
      });

      const result = mapExportLogsServiceRequestToLogEvents(
        minimalRequest,
        createMockLogOptions()
      );

      const logEvent = result[0];
      expect(logEvent.event).toEqual({ message: null });
    });
  });
});
