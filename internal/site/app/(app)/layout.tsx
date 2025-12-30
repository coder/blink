import { auth } from "@/app/(auth)/auth";
import { GlobalShortcuts } from "@/components/global-shortcuts";
import { LogoBlink } from "@/components/icons";
import { ThemeColorMeta } from "@/components/theme-color-meta";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import "../globals.css";
import { PostHog } from "./telemetry/posthog";
import { PostHogProviderWrapper } from "./telemetry/posthog-provider";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const isOpen = cookieStore.get("sidebar:state")?.value !== "false";
  const sidebarWidth = cookieStore.get("sidebar:width")?.value;

  // Redirect to login if not authenticated
  if (!session || !session.user) {
    redirect("/login");
  }

  // if (
  //   true &&
  //   session?.user?.email !== "kyle@carberry.com" &&
  //   session?.user?.email !== "matthewjvollmer@outlook.com"
  // ) {
  //   return <MaintenanceMode />;
  // }

  return (
    <PostHogProviderWrapper>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <ThemeColorMeta
          lightColor={LIGHT_THEME_COLOR}
          darkColor={DARK_THEME_COLOR}
        />
        <PostHog userId={session?.user?.id} email={session?.user?.email} />
        <Toaster position="top-center" />
        <SidebarProvider defaultOpen={isOpen} defaultWidth={sidebarWidth}>
          <GlobalShortcuts />
          <div className="flex flex-col h-screen flex-1 relative min-h-0">
            {children}
          </div>
        </SidebarProvider>
      </ThemeProvider>
    </PostHogProviderWrapper>
  );
}

const MaintenanceMode = () => {
  return (
    <div className="bg-neutral-900 p-2 md:p-4 min-h-screen flex flex-col">
      <div className="bg-black rounded-lg flex-1 flex items-center justify-center">
        <div className="text-center space-y-8 px-4 flex flex-col items-center">
          <div className="flex justify-center">
            <LogoBlink size={24} />
          </div>
          <div className="space-y-4">
            <h1 className="text-lg md:text-xl font-medium text-white">
              Maintenance Mode
            </h1>
            <p className="text-neutral-400 max-w-xs mx-auto">
              Blink is getting some upgrades. Please check back later.
            </p>
          </div>
          <div className="mb-4">
            <Link
              href="https://join.slack.com/t/chatwithblink/shared_invite/zt-3a4p09td0-6aA2PONWUsGtgX47CfB8ew"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#4A154B] hover:bg-[#350d36] text-white rounded-lg transition-colors"
            >
              Join us on Slack
            </Link>
          </div>
          <Link href="/home" className="text-sm">
            <div className="text-neutral-400 hover:text-white transition-colors">
              Go Home
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
};

const LIGHT_THEME_COLOR = "hsl(0 0% 100%)";
const DARK_THEME_COLOR = "hsl(240deg 10% 3.92%)";

// Fixed theme initialization script that properly syncs with next-themes
// See: https://github.com/opennextjs/opennextjs-cloudflare/issues/511
const fixedThemeBlindScript = `
(function() {
  try {
    const storageKey = 'theme';
    const defaultTheme = 'system';
    const themes = ['light', 'dark'];
    
    function getSystemTheme() {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    
    function applyTheme(theme) {
      const root = document.documentElement;
      const resolvedTheme = theme === 'system' ? getSystemTheme() : theme;
      
      // Remove existing theme classes
      themes.forEach(t => root.classList.remove(t));
      
      // Add the resolved theme class
      root.classList.add(resolvedTheme);
      
      // Set color-scheme for better browser integration
      root.style.colorScheme = resolvedTheme;
    }
    
    // Get theme from localStorage or use default
    let storedTheme;
    try {
      storedTheme = localStorage.getItem(storageKey);
    } catch (e) {
      // localStorage might not be available
    }
    
    const theme = storedTheme || defaultTheme;
    
    // Apply the theme immediately to prevent flash
    applyTheme(theme);
    
    // Ensure the theme is stored in localStorage for next-themes to read
    if (storedTheme !== theme) {
      try {
        localStorage.setItem(storageKey, theme);
      } catch (e) {
        // localStorage might not be available
      }
    }
  } catch (e) {
    // Fallback: apply dark theme if anything fails
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();
`;
