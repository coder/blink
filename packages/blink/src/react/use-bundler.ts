import { useEffect, useMemo, useRef, useState } from "react";
import { resolveConfig, type BuildLog, type BuildResult } from "../build";
import { Logger } from "./use-logger";

export type BundlerStatus = "building" | "success" | "error";

export interface BundlerContext {
  readonly error: BuildLog | undefined;
  readonly result: BuildResult | undefined;
  readonly entry: string;
  readonly outdir: string;
  readonly status: BundlerStatus;
}

export interface UseBundlerOptions {
  readonly directory: string;
  readonly logger: Logger;
  readonly onBuildStart?: () => void;
  readonly onBuildSuccess?: (
    result: BuildResult & { duration: number }
  ) => void;
  readonly onBuildError?: (error: BuildLog) => void;
}

/**
 * useBundler is a hook that builds the agent and provides the build result.
 *
 * @param options - Options for the bundler (or just directory string for backwards compatibility).
 * @returns Context for the bundler.
 */
export default function useBundler(options: UseBundlerOptions | string) {
  // Support both string (directory) and object (options) for backwards compatibility
  const opts =
    typeof options === "string"
      ? {
          directory: options,
          logger: new Logger(async () => {}),
        }
      : options;
  const { directory, logger, onBuildStart, onBuildSuccess, onBuildError } =
    opts;

  const config = useMemo(() => resolveConfig(directory), [directory]);

  const [error, setError] = useState<BuildLog | undefined>(undefined);
  const [result, setResult] = useState<BuildResult | undefined>(undefined);
  const [status, setStatus] = useState<BundlerStatus>("building");

  // Use refs for callbacks to avoid re-running the effect when they change
  const onBuildStartRef = useRef(onBuildStart);
  const onBuildSuccessRef = useRef(onBuildSuccess);
  const onBuildErrorRef = useRef(onBuildError);

  useEffect(() => {
    onBuildStartRef.current = onBuildStart;
    onBuildSuccessRef.current = onBuildSuccess;
    onBuildErrorRef.current = onBuildError;
  }, [onBuildStart, onBuildSuccess, onBuildError]);

  useEffect(() => {
    const controller = new AbortController();

    config
      .build({
        cwd: directory,
        entry: config.entry,
        outdir: config.outdir,
        watch: true,
        dev: true,
        signal: controller.signal,
        onStart: () => {
          setStatus("building");
          setError(undefined);
          setResult(undefined);
          onBuildStartRef.current?.();
        },
        onResult: (result) => {
          if ("error" in result) {
            setError(result.error);
            setStatus("error");
            onBuildErrorRef.current?.(result.error);
          } else {
            setResult(result);
            setStatus("success");
            onBuildSuccessRef.current?.(
              result as BuildResult & { duration: number }
            );
          }
        },
      })
      .catch((err) => {
        logger.error("system", "error", err);
        setStatus("error");
        setError(err);
        onBuildErrorRef.current?.(err);
      });

    return () => {
      controller.abort();
    };
  }, [directory]);

  return useMemo<BundlerContext>(() => {
    return {
      error,
      status,
      result,
      entry: config.entry,
      outdir: config.outdir,
    };
  }, [error, status, result, config.entry, config.outdir]);
}
