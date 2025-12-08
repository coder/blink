"use client";

import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

export function PostHog({
  userId,
  email,
}: {
  userId: string | undefined;
  email: string | undefined | null;
}) {
  const posthog = usePostHog();
  useEffect(() => {
    if (!userId) {
      return;
    }
    let userParams: Record<string, string> | undefined = undefined;
    if (email) {
      userParams = {
        email,
      };
    }
    posthog.identify(userId, userParams);
  }, [userId, email]);
  return null;
}
