import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://blink.so");
  const host = base.hostname;

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms", "/login", "/signup"],
        disallow: [
          "/email-verification",
          "/invite/",
          "/create-team",
          "/recent-chats",
          "/shortcuts",
          "/team",
          "/user",
          "/chat",
          "/api/",
          "/_next/",
        ],
      },
    ],
    sitemap: [`${base.origin}/sitemap.xml`],
    host,
  };
}
