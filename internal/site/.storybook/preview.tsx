import type { Preview } from "@storybook/react";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "../app/globals.css";
import { ThemeProvider } from "../components/theme-provider";
import { TooltipProvider } from "../components/ui/tooltip";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    nextjs: {
      appDirectory: true,
    },
  },
  decorators: [
    (Story) => {
      if (!document.documentElement.classList.contains(geist.variable)) {
        document.documentElement.classList.add(geist.variable);
      }
      if (!document.documentElement.classList.contains(geistMono.variable)) {
        document.documentElement.classList.add(geistMono.variable);
      }

      return (
        <ThemeProvider attribute="class" defaultTheme="dark">
          <TooltipProvider delayDuration={0}>
            <Toaster position="top-center" />
            <Story />
          </TooltipProvider>
        </ThemeProvider>
      );
    },
  ],
};

export default preview;
