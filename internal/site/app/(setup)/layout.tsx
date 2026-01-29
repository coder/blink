import { Geist } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";

import "../(public)/styles.css";

// Load LayGrotesk via next/font/local for proper preloading
const layGrotesk = localFont({
  src: [
    {
      path: "../../public/fonts/LayGrotesk-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/LayGrotesk-Medium.woff2",
      weight: "500",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-laygrotesk",
});

const geist = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
  preload: true,
  fallback: ["system-ui", "arial"],
  variable: "--font-geist",
});

export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider forcedTheme="dark" attribute="class">
      <div
        className={`bg-[#090B0B] min-h-screen flex items-center justify-center ${layGrotesk.className} ${layGrotesk.variable} ${geist.variable}`}
      >
        {children}
      </div>
    </ThemeProvider>
  );
}
