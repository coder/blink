"use client";

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect } from "react";

export function PostHogProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (posthogKey && typeof window !== "undefined") {
      posthog.init(posthogKey, {
        api_host: "/phogrelay",
        ui_host: "https://us.posthog.com",
        defaults: "2025-05-24",
      });
    }
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
