import { decode } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

// Auth constants
const SESSION_COOKIE_NAME = "blink_session_token";

async function posthogMiddleware(request: NextRequest) {
  const url = request.nextUrl.clone();
  const hostname = url.pathname.startsWith("/phogrelay/static/")
    ? "us-assets.i.posthog.com"
    : "us.i.posthog.com";
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("host", hostname);

  url.protocol = "https";
  url.hostname = hostname;
  url.port = "443";
  url.pathname = url.pathname.replace(/^\/phogrelay/, "");

  return NextResponse.rewrite(url, {
    headers: requestHeaders,
  });
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname.startsWith("/phogrelay/")) {
    return posthogMiddleware(request);
  }

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  if (searchParams.get("team")) {
    const url = new URL(request.url);
    url.searchParams.delete("team");
    const res = NextResponse.redirect(url);
    res.cookies.set("selected-team", searchParams.get("team")!);
    return res;
  }

  // Check for legacy cookies and migrate if needed
  let response: NextResponse | null = null;
  const currentCookie = request.cookies.get(SESSION_COOKIE_NAME);

  if (!currentCookie) {
    // Try to find a legacy cookie
    for (const legacyName of [
      "authjs.session-token",
      "__Secure-authjs.session-token",
    ]) {
      const legacyCookie = request.cookies.get(legacyName);
      if (legacyCookie?.value) {
        // Create response with migrated cookie
        response = NextResponse.next();
        response.cookies.set(SESSION_COOKIE_NAME, legacyCookie.value, {
          httpOnly: true,
          sameSite: "lax",
          secure: false,
          path: "/",
          maxAge: 30 * 24 * 60 * 60, // 30 days
        });
        // Delete the old cookie
        response.cookies.delete(legacyName);
        break;
      }
    }
  }

  // Check for authentication
  const tokenValue =
    currentCookie?.value ||
    (response ? response.cookies.get(SESSION_COOKIE_NAME)?.value : undefined);

  let token = null;
  if (tokenValue) {
    try {
      token = await decode({
        token: tokenValue,
        secret: process.env.AUTH_SECRET!,
        salt: SESSION_COOKIE_NAME,
      });
    } catch {
      // Invalid token, ignore
    }
  }

  if (token && pathname === "/") {
    if (response) {
      // Preserve cookie migration in redirect
      const redirect = NextResponse.redirect(new URL("/chat", request.url));
      redirect.cookies.set(SESSION_COOKIE_NAME, tokenValue!, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      });
      // Delete legacy cookies
      for (const legacyName of [
        "authjs.session-token",
        "__Secure-authjs.session-token",
      ]) {
        redirect.cookies.delete(legacyName);
      }
      return redirect;
    }
    return NextResponse.redirect(new URL("/chat", request.url));
  }

  return response || NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/signup",
    "/team/:path*",
    "/user/:path*",
    "/setup",
    "/s/:path*",
    "/phogrelay/:path*",
  ],
};
