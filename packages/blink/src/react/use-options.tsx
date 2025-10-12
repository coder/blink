import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  lastUIOptions,
  type UIOptions,
  type UIOptionsSchema,
} from "../agent/index.browser";
import type { CapabilitiesResponse, Client } from "../agent/client";

/**
 * useOptions is a hook that provides the selectable and selected options
 * for a given agent.
 *
 * @param agent - The agent to use.
 * @param messages - The messages to use.
 * @returns The selectable and selected options.
 */
export default function useOptions({
  agent,
  capabilities,
  messages,
}: {
  agent?: Pick<Client, "ui">;
  capabilities?: CapabilitiesResponse;
  messages: UIMessage[];
}) {
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [schema, setSchema] = useState<UIOptionsSchema<UIOptions> | undefined>(
    undefined
  );
  const currentSchema = useRef<UIOptionsSchema<UIOptions> | undefined>(schema);
  useEffect(() => {
    currentSchema.current = schema;
  }, [schema]);

  const [lastMessageOptions, setLastMessageOptions] = useState<
    UIOptions | undefined
  >(() => {
    return lastUIOptions(messages);
  });
  useEffect(() => {
    // We don't want this to re-render every time the messages change.
    // Because typically, the options are not changing.
    setLastMessageOptions((prev) => {
      const newOptions = lastUIOptions(messages);
      if (JSON.stringify(newOptions) === JSON.stringify(prev)) {
        return prev;
      }
      return newOptions;
    });
  }, [messages]);

  const [options, setOptions] = useState<UIOptions | undefined>(undefined);

  const isValidOption = useCallback((id: string, value: string) => {
    if (!currentSchema.current) {
      return false;
    }
    const option = currentSchema.current[id];
    if (!option) {
      return false;
    }
    return option.values.some((v) => v.id === value);
  }, []);

  const updateOptions = useCallback(
    (updates?: Partial<UIOptions>) => {
      setOptions((prev) => {
        const newOptions = {
          ...lastMessageOptions,
          ...prev,
          ...updates,
        } as UIOptions;
        for (const [key, value] of Object.entries(newOptions)) {
          if (!isValidOption(key, value)) {
            delete newOptions[key];
          }
        }
        for (const [key, value] of Object.entries(
          currentSchema.current ?? {}
        )) {
          if (!newOptions[key] && value.defaultValue !== undefined) {
            newOptions[key] = value.defaultValue;
          }
        }
        if (JSON.stringify(newOptions) === JSON.stringify(prev)) {
          // Don't update the options if they are the same.
          return prev;
        }
        return newOptions;
      });
    },
    [lastMessageOptions, isValidOption]
  );

  // Whenever the options from messages change, we update the selected options.
  // This is to ensure that the chat state always reflects the user-state.
  useEffect(() => {
    if (!lastMessageOptions && !schema) {
      setOptions(undefined);
      return;
    }
    updateOptions();
  }, [lastMessageOptions, schema, updateOptions]);

  // Track the last successfully requested selectedOptions to avoid redundant refetches.
  const lastRequestedOptionsJson = useRef<string | undefined>(undefined);

  // Reset all option state when the agent changes so the new agent's schema is source of truth.
  const lastAgentRef = useRef<object | undefined>(undefined);
  useEffect(() => {
    if (agent !== lastAgentRef.current) {
      lastAgentRef.current = agent;
      setSchema(undefined);
      setOptions(undefined);
      setError(undefined);
      setLoading(true);
      lastRequestedOptionsJson.current = undefined;
    }
  }, [agent]);

  // This fetches the options schema from the agent.
  // This triggers whenever the selected options change.
  useEffect(() => {
    if ((capabilities && !capabilities.ui) || !agent) {
      setSchema(undefined);
      setOptions(undefined);
      setError(undefined);
      lastRequestedOptionsJson.current = undefined;
      return;
    }

    const currentOptionsJson = options ? JSON.stringify(options) : "";

    // If we've already requested with the same selectedOptions, skip.
    if (lastRequestedOptionsJson.current === currentOptionsJson) {
      setLoading(false);
      setError(undefined);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    agent
      .ui(options ? { selectedOptions: options } : {}, {
        signal: controller.signal,
      })
      .then((newSchema) => {
        if (!newSchema) {
          setSchema(undefined);
          return;
        }
        if (controller.signal.aborted) {
          return;
        }
        setSchema((prev) => {
          // Avoid infinite loop if schema hasn't changed
          if (JSON.stringify(prev) === JSON.stringify(newSchema)) {
            return prev;
          }
          return newSchema;
        });
        lastRequestedOptionsJson.current = currentOptionsJson;
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [agent, capabilities, options]);

  /**
   * setOption sets the value of an option by it's ID.
   * If the option is not found in the schema, it is ignored.
   */
  const setOption = useCallback(
    (id: string, value: string) => {
      updateOptions({ [id]: value });
    },
    [updateOptions]
  );

  return {
    schema,
    options,
    setOption,
    loading,
    error,
  };
}
