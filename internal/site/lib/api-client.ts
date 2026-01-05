"use client";

import Client from "@blink.so/api";
import { useMemo } from "react";

export function useAPIClient() {
  return useMemo(
    () =>
      new Client({
        baseURL:
          typeof window !== "undefined" ? window.location.origin : undefined,
      }),
    []
  );
}
