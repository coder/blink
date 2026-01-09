import { fromBinary, fromJsonString } from "@bufbuild/protobuf";
import { HTTPException } from "hono/http-exception";
import { Buffer } from "node:buffer";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import {
  type ExportLogsServiceRequest,
  ExportLogsServiceRequestSchema,
} from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb";
import {
  type ExportTraceServiceRequest,
  ExportTraceServiceRequestSchema,
} from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";
import type {
  AnyValue,
  KeyValue,
} from "./gen/opentelemetry/proto/common/v1/common_pb";
import type {
  LogRecord,
  ResourceLogs,
  ScopeLogs,
} from "./gen/opentelemetry/proto/logs/v1/logs_pb";
import type {
  ResourceSpans,
  ScopeSpans,
  Span,
  Span_Event,
  Span_Link,
  Status,
} from "./gen/opentelemetry/proto/trace/v1/trace_pb";
import {
  Span_SpanKind,
  Status_StatusCode,
} from "./gen/opentelemetry/proto/trace/v1/trace_pb";

type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface OtelEvent {
  time: string;
  name: string;
  dropped_attributes_count: number;
  attributes: Record<string, unknown>;
}

export interface OtelLink {
  linked_trace_id: string;
  linked_span_id: string;
  trace_state: string;
  flags: number;
  dropped_attributes_count: number;
  attributes: Record<string, unknown>;
}

export interface Resource {
  attributes: Record<string, unknown>;
  dropped_attributes_count: number;
  schema_url?: string | undefined;
}

export interface Scope {
  name: string | undefined;
  version: string | undefined;
  attributes: Record<string, unknown>;
  dropped_attributes_count: number;
  schema_url?: string | undefined;
}

export interface OtelSpanData {
  duration_ns: string;
  trace_id: string;
  id: string;
  parent_span_id: string;
  name: string;
  kind: string;
  status_code: string;
  status_message: string;
  trace_state: string;
  flags: number;
  dropped_attributes_count: number;
  dropped_events_count: number;
  dropped_links_count: number;
  attributes: Record<string, unknown>;
  events: OtelEvent[];
  links: OtelLink[];
}

export interface OtelPayload {
  span: OtelSpanData;
  resource: Resource;
  scope: Scope;
}

export interface OtelSpan {
  agent_id: string;
  start_time: string;
  end_time: string;
  payload: OtelPayload;
}

export interface TraceOptions {
  agent_id: string;
  deployment_id: string;
  deployment_target_id: string;
  run_id?: string;
  step_id?: string;
  chat_id?: string;
}

export function mapExportTraceServiceRequestToOtelSpans(
  request: ExportTraceServiceRequest,
  options: TraceOptions
): OtelSpan[] {
  const rows: OtelSpan[] = [];

  for (const resourceSpans of request.resourceSpans) {
    rows.push(...mapResourceSpans(resourceSpans, options));
  }

  return rows;
}

function mapResourceSpans(
  resourceSpans: ResourceSpans,
  options: TraceOptions
): OtelSpan[] {
  const resourceAttrs = keyValuesToRecord(
    resourceSpans.resource?.attributes ?? []
  );

  resourceAttrs.blink = {
    agent_id: options.agent_id,
    deployment_id: options.deployment_id,
    deployment_target_id: options.deployment_target_id,
    ...(options.run_id ? { run_id: options.run_id } : {}),
    ...(options.step_id ? { step_id: options.step_id } : {}),
    ...(options.chat_id ? { chat_id: options.chat_id } : {}),
  };

  const rows: OtelSpan[] = [];

  for (const scopeSpans of resourceSpans.scopeSpans) {
    rows.push(
      ...mapScopeSpans({
        scopeSpans,
        agentId: options.agent_id,
        resourceAttributes: resourceAttrs,
        resourceDroppedAttributesCount:
          resourceSpans.resource?.droppedAttributesCount ?? 0,
        resourceSchemaUrl: normalizeSchemaUrl(resourceSpans.schemaUrl),
      })
    );
  }

  return rows;
}

function mapScopeSpans(args: {
  scopeSpans: ScopeSpans;
  agentId: string;

  resourceAttributes: Record<string, unknown>;
  resourceDroppedAttributesCount: number;
  resourceSchemaUrl?: string | undefined;
}): OtelSpan[] {
  const {
    scopeSpans,
    agentId,
    resourceAttributes,
    resourceSchemaUrl,
    resourceDroppedAttributesCount,
  } = args;

  const scope = scopeSpans.scope;
  const scopeAttributes = keyValuesToRecord(scope?.attributes ?? []);

  const scopeName = normalizeEmpty(scope?.name);
  const scopeVersion = normalizeEmpty(scope?.version);
  const scopeDroppedAttributesCount = scope?.droppedAttributesCount ?? 0;
  const scopeSchemaUrl = normalizeSchemaUrl(scopeSpans.schemaUrl);

  const spanRows: OtelSpan[] = [];

  for (const span of scopeSpans.spans) {
    spanRows.push(
      mapSpan({
        span,
        agentId,
        resourceAttributes,
        resourceDroppedAttributesCount,
        resourceSchemaUrl,
        scopeAttributes,
        scopeName,
        scopeVersion,
        scopeDroppedAttributesCount,
        scopeSchemaUrl,
      })
    );
  }

  return spanRows;
}

function mapSpan(args: {
  span: Span;
  agentId: string;
  resourceAttributes: Record<string, unknown>;
  resourceDroppedAttributesCount: number;
  resourceSchemaUrl?: string | undefined;
  scopeAttributes: Record<string, unknown>;
  scopeName: string | undefined;
  scopeVersion: string | undefined;
  scopeDroppedAttributesCount: number;
  scopeSchemaUrl?: string | undefined;
}): OtelSpan {
  const {
    span,
    agentId,
    resourceAttributes,
    resourceDroppedAttributesCount,
    resourceSchemaUrl,
    scopeAttributes,
    scopeName,
    scopeVersion,
    scopeDroppedAttributesCount,
    scopeSchemaUrl,
  } = args;

  const spanAttributes = keyValuesToRecord(span.attributes ?? []);

  const statusCode = normalizeStatusCode(span.status);
  const statusMessage = normalizeEmpty(span.status?.message) ?? "";

  const startTime = formatUnixNano(span.startTimeUnixNano);
  const endTime = formatUnixNano(span.endTimeUnixNano);
  const durationNs = bigIntToUnsignedString(
    span.endTimeUnixNano > span.startTimeUnixNano
      ? span.endTimeUnixNano - span.startTimeUnixNano
      : BigInt(0)
  );

  return {
    agent_id: agentId,
    start_time: startTime,
    end_time: endTime,
    payload: {
      span: {
        duration_ns: durationNs,
        trace_id: uint8ArrayToHexString(span.traceId),
        id: uint8ArrayToHexString(span.spanId),
        parent_span_id: uint8ArrayToHexString(span.parentSpanId),
        name: span.name,
        kind: spanKindLabel(span.kind),
        status_code: statusCodeLabel(statusCode),
        status_message: statusMessage,
        trace_state: span.traceState ?? "",
        flags: span.flags ?? 0,
        dropped_attributes_count: span.droppedAttributesCount ?? 0,
        dropped_events_count: span.droppedEventsCount ?? 0,
        dropped_links_count: span.droppedLinksCount ?? 0,
        attributes: spanAttributes,
        events: mapEvents(span.events ?? []),
        links: mapLinks(span.links ?? []),
      },
      resource: {
        attributes: resourceAttributes,
        dropped_attributes_count: resourceDroppedAttributesCount,
        schema_url: resourceSchemaUrl,
      },
      scope: {
        name: scopeName,
        version: scopeVersion,
        attributes: scopeAttributes,
        dropped_attributes_count: scopeDroppedAttributesCount,
        schema_url: scopeSchemaUrl,
      },
    },
  };
}

function normalizeStatusCode(status: Status | undefined): Status_StatusCode {
  if (!status) {
    return Status_StatusCode.UNSET;
  }
  if (status.code === undefined || status.code === null) {
    return Status_StatusCode.UNSET;
  }
  return status.code;
}

function mapEvents(events: Span_Event[]): OtelEvent[] {
  return events.map((event) => ({
    time: formatUnixNano(event.timeUnixNano),
    name: event.name,
    dropped_attributes_count: event.droppedAttributesCount ?? 0,
    attributes: keyValuesToRecord(event.attributes ?? []),
  }));
}

function mapLinks(links: Span_Link[]): OtelLink[] {
  return links.map((link) => ({
    linked_trace_id: uint8ArrayToHexString(link.traceId),
    linked_span_id: uint8ArrayToHexString(link.spanId),
    trace_state: link.traceState ?? "",
    flags: link.flags ?? 0,
    dropped_attributes_count: link.droppedAttributesCount ?? 0,
    attributes: keyValuesToRecord(link.attributes ?? []),
  }));
}

function keyValuesToRecord(entries: KeyValue[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const entry of entries) {
    if (!entry || !entry.key) {
      continue;
    }
    result[entry.key] = anyValueToJson(entry.value);
  }

  return result;
}

function anyValueToJson(value: AnyValue | undefined): unknown {
  if (!value || value.value.case === undefined) {
    return null;
  }

  switch (value.value.case) {
    case "stringValue":
      return value.value.value;
    case "boolValue":
      return value.value.value;
    case "intValue": {
      const bigintValue = value.value.value;
      const numberValue = Number(bigintValue);
      if (!Number.isSafeInteger(numberValue)) {
        return bigintValue.toString();
      }
      return numberValue;
    }
    case "doubleValue":
      return value.value.value;
    case "arrayValue":
      return value.value.value.values.map((item) => anyValueToJson(item));
    case "kvlistValue":
      return keyValuesToRecord(value.value.value.values ?? []);
    case "bytesValue":
      return Buffer.from(value.value.value).toString("base64");
    default:
      const _exhaustiveCheck: never = value.value;
      console.warn(`Unhandled any value case: ${value.value}`);
      return null;
  }
}

function isPlainRecord(val: unknown): val is Record<string | number, unknown> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return false;
  }
  if (Object.prototype.toString.call(val) !== "[object Object]") {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

/**
 * - If body is parsed JSON object -> use it directly as payload
 * - If body has a `message` field that is a plain object -> spread it into root
 * - If body is a string or array -> wrap as { message: value }
 */
function buildLogPayload(body: AnyValue | undefined): Record<string, unknown> {
  const bodyContent = anyValueToJson(body);

  // If body is not a plain object, wrap it in { message: value }
  if (!isPlainRecord(bodyContent)) {
    return { message: bodyContent };
  }

  // If body has a `message` field that is a plain object, spread it into root
  // and overlay other fields on top (allows user to override payload fields)
  if ("message" in bodyContent && isPlainRecord(bodyContent.message)) {
    const { message, ...rest } = bodyContent;
    return { ...message, ...rest };
  }

  return bodyContent;
}

function normalizeSchemaUrl(schemaUrl: string | undefined): string | undefined {
  return normalizeEmpty(schemaUrl);
}

function normalizeEmpty(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function formatUnixNano(unixNano: bigint): string {
  const seconds = Number(unixNano / BigInt(1_000_000_000));
  const nanos = Number(unixNano % BigInt(1_000_000_000));

  const date = new Date(seconds * 1000);

  const year = date.getUTCFullYear();
  const month = padNumber(date.getUTCMonth() + 1, 2);
  const day = padNumber(date.getUTCDate(), 2);
  const hours = padNumber(date.getUTCHours(), 2);
  const minutes = padNumber(date.getUTCMinutes(), 2);
  const secondsPart = padNumber(date.getUTCSeconds(), 2);
  const nanoPart = padNumber(nanos, 9);

  return `${year}-${month}-${day} ${hours}:${minutes}:${secondsPart}.${nanoPart}`;
}

function padNumber(value: number, length: number): string {
  return value.toString().padStart(length, "0");
}

function spanKindLabel(kind: Span["kind"]): string {
  switch (kind) {
    case Span_SpanKind.INTERNAL:
      return "INTERNAL";
    case Span_SpanKind.SERVER:
      return "SERVER";
    case Span_SpanKind.CLIENT:
      return "CLIENT";
    case Span_SpanKind.PRODUCER:
      return "PRODUCER";
    case Span_SpanKind.CONSUMER:
      return "CONSUMER";
    case Span_SpanKind.UNSPECIFIED:
      return "UNSPECIFIED";
    default:
      const _exhaustiveCheck: never = kind;
      console.warn(`Unhandled span kind: ${kind}`);
      return "UNSPECIFIED";
  }
}

function statusCodeLabel(code: Status_StatusCode): string {
  switch (code) {
    case Status_StatusCode.OK:
      return "OK";
    case Status_StatusCode.ERROR:
      return "ERROR";
    case Status_StatusCode.UNSET:
      return "UNSET";
    default:
      const _exhaustiveCheck: never = code;
      console.warn(`Unhandled status code: ${code}`);
      return "UNSET";
  }
}

function bigIntToUnsignedString(value: bigint): string {
  return value < BigInt(0) ? "0" : value.toString();
}

function uint8ArrayToHexString(value: Uint8Array | undefined): string {
  if (!value || value.length === 0) {
    return "";
  }
  return Array.from(value)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function parseOtlpHttpTraces(
  req: Request
): Promise<ExportTraceServiceRequest> {
  if (!req.body) {
    throw new HTTPException(415, { message: "No body" });
  }

  const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
  const contentEncoding = (
    req.headers.get("content-encoding") ?? ""
  ).toLowerCase();

  if (ctype.includes("application/x-protobuf")) {
    const rawBody = new Uint8Array(await req.arrayBuffer());
    const body = decompressBody(rawBody, contentEncoding);
    return fromBinary(ExportTraceServiceRequestSchema, body);
  }

  if (ctype.includes("application/json")) {
    const jsonBody = await req.json();
    return fromJsonString(
      ExportTraceServiceRequestSchema,
      // OTLP/JSON spec encodes traceId/spanId as hex strings, but protobuf's JSON parser
      // expects base64 for bytes fields. This mismatch causes incorrect decoding (it tries
      // to base64-decode the hex strings). Fix: convert hex to base64 before parsing.
      // See: https://github.com/open-telemetry/opentelemetry-proto/blob/84c25afa92b5a242cbac9d0a7bf325b8fbdfda76/docs/specification.md?plain=1#L409
      JSON.stringify(convertOtelHexIds(jsonBody))
    );
  }

  throw new HTTPException(415, { message: "Unsupported Content-Type" });
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) {
    throw new Error("invalid hex length");
  }
  return Uint8Array.fromHex(s);
}

function looksHex(v: unknown): v is string {
  if (typeof v !== "string") {
    return false;
  }
  const s = v.startsWith("0x") ? v.slice(2) : v;
  return s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

// Recursively convert only OTLP id fields (hex) to base64
function convertOtelHexIds(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(convertOtelHexIds);
  }
  if (input && typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (k === "traceId" || k === "spanId" || k === "parentSpanId") {
        const v = obj[k];
        if (looksHex(v)) {
          obj[k] = hexToBytes(v).toBase64();
        }
      } else {
        obj[k] = convertOtelHexIds(obj[k]);
      }
    }
  }
  return input;
}

// ==================== LOGS ====================

export interface OtelLogEvent {
  agent_id: string;
  event: Record<string, unknown>;
}

export interface LogOptions {
  agent_id: string;
  deployment_id: string;
  deployment_target_id: string;
}

function decompressBody(body: Uint8Array, contentEncoding: string): Uint8Array {
  if (!contentEncoding) {
    return body;
  }

  if (contentEncoding.includes("gzip")) {
    return new Uint8Array(gunzipSync(body));
  }

  if (contentEncoding.includes("deflate")) {
    return new Uint8Array(inflateSync(body));
  }

  if (contentEncoding.includes("br")) {
    return new Uint8Array(brotliDecompressSync(body));
  }

  throw new HTTPException(415, {
    message: `Unsupported Content-Encoding: ${contentEncoding}`,
  });
}

export async function parseOtlpHttpLogs(
  req: Request
): Promise<ExportLogsServiceRequest> {
  if (!req.body) {
    throw new HTTPException(415, { message: "No body" });
  }

  const ctype = (req.headers.get("content-type") ?? "").toLowerCase();
  const contentEncoding = (
    req.headers.get("content-encoding") ?? ""
  ).toLowerCase();

  if (ctype.includes("application/x-protobuf")) {
    const rawBody = new Uint8Array(await req.arrayBuffer());
    const body = decompressBody(rawBody, contentEncoding);
    return fromBinary(ExportLogsServiceRequestSchema, body);
  }

  if (ctype.includes("application/json")) {
    const jsonBody = await req.json();
    return fromJsonString(
      ExportLogsServiceRequestSchema,
      // OTLP/JSON spec encodes traceId/spanId as hex strings, but protobuf's JSON parser
      // expects base64 for bytes fields. This mismatch causes incorrect decoding.
      // Fix: convert hex to base64 before parsing.
      JSON.stringify(convertOtelHexIds(jsonBody))
    );
  }

  throw new HTTPException(415, { message: "Unsupported Content-Type" });
}

export function mapExportLogsServiceRequestToLogEvents(
  request: ExportLogsServiceRequest,
  options: LogOptions
): OtelLogEvent[] {
  const events: OtelLogEvent[] = [];

  for (const resourceLogs of request.resourceLogs) {
    events.push(...mapResourceLogs(resourceLogs, options));
  }

  return events;
}

function mapResourceLogs(
  resourceLogs: ResourceLogs,
  options: LogOptions
): OtelLogEvent[] {
  const events: OtelLogEvent[] = [];

  for (const scopeLogs of resourceLogs.scopeLogs) {
    events.push(...mapScopeLogs(scopeLogs, options));
  }

  return events;
}

function mapScopeLogs(
  scopeLogs: ScopeLogs,
  options: LogOptions
): OtelLogEvent[] {
  const events: OtelLogEvent[] = [];

  for (const logRecord of scopeLogs.logRecords) {
    events.push(mapLogRecord(logRecord, options));
  }

  return events;
}

function mapLogRecord(logRecord: LogRecord, options: LogOptions): OtelLogEvent {
  const payload = buildLogPayload(logRecord.body);

  return {
    agent_id: options.agent_id,
    event: payload,
  };
}
