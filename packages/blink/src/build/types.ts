export interface BuildLog {
  readonly message: string;
  readonly file?: string;
}

export type BuildResult =
  | {
      readonly entry: string;
      readonly outdir: string;
      readonly warnings: BuildLog[];
      /**
       * duration is the duration of the build in milliseconds.
       */
      readonly duration: number;
    }
  | {
      readonly error: BuildLog;
    };

/**
 * BuildContext is context passed to the build function.
 *
 * It is the implementors responsibility to handle `watch`
 * and to appropriately call `onStart` and `onEnd`.
 */
export interface BuildContext {
  readonly entry: string;
  readonly outdir: string;
  readonly cwd: string;
  readonly dev?: boolean;
  readonly watch?: boolean;
  readonly signal?: AbortSignal;

  readonly onStart: () => void;
  readonly onResult: (result: BuildResult) => void;
}
