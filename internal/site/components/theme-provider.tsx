"use client";

import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      scriptProps={{
        "data-cfasync": "false",
      }}
      disableTransitionOnChange={true}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
