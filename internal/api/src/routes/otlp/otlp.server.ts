import { create } from "@bufbuild/protobuf";
import type { APIServer } from "../../server";
import { withAgentInvocationAuth } from "../agents/me/me.server";
import {
  mapExportTraceServiceRequestToOtelSpans,
  parseOtlpHttpTraces,
} from "./convert";
import { ExportTraceServiceResponseSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";

export default function mountOtlp(server: APIServer) {
  // /api/otlp/v1/traces
  server.post("/v1/traces", withAgentInvocationAuth, async (c) => {
    const parsedTraces = await parseOtlpHttpTraces(c.req.raw);
    const spans = mapExportTraceServiceRequestToOtelSpans(parsedTraces, {
      agent_id: c.get("agent_id"),
      deployment_id: c.get("agent_deployment_id"),
      deployment_target_id: c.get("agent_deployment_target_id"),
      run_id: c.get("run_id"),
      step_id: c.get("step_id"),
      chat_id: c.get("chat_id"),
    });

    await c.env.traces.write(spans);

    return c.json(create(ExportTraceServiceResponseSchema, {}), 200);
  });
}
