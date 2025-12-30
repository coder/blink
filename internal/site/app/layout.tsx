import { auth } from "@/app/(auth)/auth";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blink",
  description:
    "Build and deploy Slack agents from your terminal. Open source, local-first agent framework.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Blink",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    shortcut: [
      {
        url: "/icon-dark.svg",
        sizes: "any",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-light.svg",
        sizes: "any",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    apple: [
      {
        url: "/icon-dark.svg",
        sizes: "any",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/icon-light.svg",
        sizes: "any",
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
      { url: "/app-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport = {
  maximumScale: 1,
};

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html
      lang="en"
      // `next-themes` injects an extra classname to the body element to avoid
      // visual flicker before hydration. Hence the `suppressHydrationWarning`
      // prop is necessary to avoid the React hydration mismatch warning.
      // https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable} antialiased`}
    >
      <body className="antialiased">
        <SessionProvider session={session}>
          <TooltipProvider>{children}</TooltipProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
