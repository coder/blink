import type { Metadata } from "next";

import Home from "./home/page";

export const metadata: Metadata = {
  metadataBase: new URL("https://blink.coder.com"),
  title: "Blink | Build and Deploy Slack Agents from Your Terminal",
  description:
    "Blink turns your instructions into fully functional Slack agents, tooled, deployed, and ready to invite to your channels — all built on open source.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Blink | Build and Deploy Slack Agents from Your Terminal",
    description:
      "Blink turns your instructions into fully functional Slack agents, tooled, deployed, and ready to invite to your channels — all built on open source.",
    url: "https://blink.coder.com",
    siteName: "Blink",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Blink - Build and Deploy Slack Agents from Your Terminal",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Blink | Build and Deploy Slack Agents from Your Terminal",
    description:
      "Blink turns your instructions into fully functional Slack agents, tooled, deployed, and ready to invite to your channels — all built on open source.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default Home;
