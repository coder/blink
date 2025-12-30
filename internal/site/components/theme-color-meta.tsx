"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

interface ThemeColorMetaProps {
  lightColor: string;
  darkColor: string;
}

export function ThemeColorMeta({ lightColor, darkColor }: ThemeColorMetaProps) {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    // Only run on client side after hydration
    if (typeof window === "undefined") return;

    const updateMetaTags = () => {
      const isDark = resolvedTheme === "dark";
      const themeColor = isDark ? darkColor : lightColor;
      const statusBarStyle = isDark ? "black-translucent" : "default";

      // Update or create theme-color meta tag
      let themeMeta = document.querySelector('meta[name="theme-color"]');
      if (!themeMeta) {
        themeMeta = document.createElement("meta");
        themeMeta.setAttribute("name", "theme-color");
        document.head.appendChild(themeMeta);
      }
      themeMeta.setAttribute("content", themeColor);

      // Update or create apple status bar style meta tag
      let appleMeta = document.querySelector(
        'meta[name="apple-mobile-web-app-status-bar-style"]'
      );
      if (!appleMeta) {
        appleMeta = document.createElement("meta");
        appleMeta.setAttribute("name", "apple-mobile-web-app-status-bar-style");
        document.head.appendChild(appleMeta);
      }
      appleMeta.setAttribute("content", statusBarStyle);
    };

    // Update immediately if theme is resolved
    if (resolvedTheme) {
      updateMetaTags();
    }
  }, [resolvedTheme, lightColor, darkColor]);

  // This component doesn't render anything
  return null;
}
