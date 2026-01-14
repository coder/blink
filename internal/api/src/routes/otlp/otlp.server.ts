import { create } from "@bufbuild/protobuf";
import type { APIServer } from "../../server";
import { withAgentAuth, withAgentDeploymentAuth } from "../agents/me/me.server";
import {
  mapExportLogsServiceRequestToLogEvents,
  mapExportTraceServiceRequestToOtelSpans,
  parseOtlpHttpLogs,
  parseOtlpHttpTraces,
} from "./convert";
import { ExportLogsServiceResponseSchema } from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb";
import { ExportTraceServiceResponseSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb";

export default function mountOtlp(server: APIServer) {
  // /api/otlp/v1/traces
  server.post("/v1/traces", withAgentAuth, async (c) => {
    const parsedTraces = await parseOtlpHttpTraces(c.req.raw);

    // For invocation tokens, IDs come from the token.
    // For deployment tokens, IDs are undefined here and will be extracted
    // per-resource inside mapExportTraceServiceRequestToOtelSpans.
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

  // /api/otlp/v1/logs
  server.post("/v1/logs", withAgentDeploymentAuth, async (c) => {
    const parsedLogs = await parseOtlpHttpLogs(c.req.raw);
    const logEvents = mapExportLogsServiceRequestToLogEvents(parsedLogs, {
      agent_id: c.get("agent_id"),
      deployment_id: c.get("agent_deployment_id"),
      deployment_target_id: c.get("agent_deployment_target_id"),
    });

    await Promise.all(
      logEvents.map((log) =>
        c.env.logs.write({
          agent_id: log.agent_id,
          event: log.event,
        })
      )
    );

    return c.json(create(ExportLogsServiceResponseSchema, {}), 200);
  });
}
