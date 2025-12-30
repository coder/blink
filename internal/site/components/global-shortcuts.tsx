"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function GlobalShortcuts() {
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isOpenNewChat =
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        (event.key === "O" || event.key === "o");

      if (isOpenNewChat) {
        event.preventDefault();
        router.push("/chat");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  return null;
}
