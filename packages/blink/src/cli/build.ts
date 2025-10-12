import { resolveConfig } from "../build";

export default async function build(directory?: string): Promise<void> {
  if (!directory) {
    directory = process.cwd();
  }

  const config = resolveConfig(directory);

  await config.build({
    cwd: directory,
    entry: config.entry,
    outdir: config.outdir,
    watch: false,
    onStart: () => {
      console.log("Building agent...");
    },
    onResult: (result) => {
      if ("error" in result) {
        console.error(result.error);
        process.exit(1);
      }
      for (const warning of result.warnings) {
        console.warn(warning.message);
      }
      console.log(`Built agent to ${result.entry}`);
    },
  });
}
