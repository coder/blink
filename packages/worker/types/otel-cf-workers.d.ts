import { ConfigurationOption } from "@microlabs/otel-cf-workers";

declare module "@microlabs/otel-cf-workers" {
  export function instrumentDO<T extends DOClass>(
    doClass: T,
    config: ConfigurationOption
  ): T;
}
