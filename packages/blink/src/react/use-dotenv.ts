import { parse } from "dotenv";
import { readFileSync, watch } from "fs";

import { useEffect, useState } from "react";
import { findNearestEntry } from "../build/util";

export default function useDotenv(
  directory: string,
  name: string = ".env.local"
) {
  const [env, setEnv] = useState<Record<string, string>>({});

  useEffect(() => {
    let watcher: ReturnType<typeof watch> | undefined;

    const readEnvFile = (path: string) => {
      try {
        const contents = readFileSync(path, "utf-8");
        const parsed = parse(contents);
        setEnv(parsed);
      } catch (error) {
        console.error(`Error reading ${name}:`, error);
        setEnv({});
      }
    };

    findNearestEntry(directory, name).then((nearest) => {
      if (!nearest) {
        // File not found - this is not necessarily an error
        setEnv({});
        return;
      }
      readEnvFile(nearest);
      watcher = watch(nearest, { persistent: false }, () => {
        readEnvFile(nearest);
      });
    });

    return () => {
      if (watcher) {
        watcher.close();
      }
    };
  }, [directory, name]);

  return env;
}
