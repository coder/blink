"use client";

import { Footer } from "@/components/footer";
import { LogoBlink } from "@/components/icons";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Geist } from "next/font/google";
import localFont from "next/font/local";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import "./styles.css";

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

// Keep Geist as fallback font
const geist = Geist({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
  preload: true,
  fallback: ["system-ui", "arial"],
  variable: "--font-geist",
});

export default function Layout({ children }: { children: ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [typedTextMobile, setTypedTextMobile] = useState("");
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const fullText = "Built\nby Coder";
  const fullTextMobile = "Built by Coder";

  // Type out "Built by Coder" on mount
  useEffect(() => {
    // Desktop typing (two lines)
    let currentIndex = 0;
    const typingInterval = setInterval(() => {
      if (currentIndex <= fullText.length) {
        setTypedText(fullText.substring(0, currentIndex));
        currentIndex++;
      } else {
        setIsTypingComplete(true);
        clearInterval(typingInterval);
      }
    }, 80);

    // Mobile typing (single line)
    let currentIndexMobile = 0;
    const typingIntervalMobile = setInterval(() => {
      if (currentIndexMobile <= fullTextMobile.length) {
        setTypedTextMobile(fullTextMobile.substring(0, currentIndexMobile));
        currentIndexMobile++;
      } else {
        clearInterval(typingIntervalMobile);
      }
    }, 80);

    return () => {
      clearInterval(typingInterval);
      clearInterval(typingIntervalMobile);
    };
  }, []);

  // Listen for copy button clicks from child components
  useEffect(() => {
    const handleCopyEvent = () => {
      // Reset and restart typing animation
      setTypedText("");
      setTypedTextMobile("");
      setIsTypingComplete(false);

      // Desktop typing (two lines)
      let currentIndex = 0;
      const typingInterval = setInterval(() => {
        if (currentIndex <= fullText.length) {
          setTypedText(fullText.substring(0, currentIndex));
          currentIndex++;
        } else {
          setIsTypingComplete(true);
          clearInterval(typingInterval);
        }
      }, 80);

      // Mobile typing (single line)
      let currentIndexMobile = 0;
      const typingIntervalMobile = setInterval(() => {
        if (currentIndexMobile <= fullTextMobile.length) {
          setTypedTextMobile(fullTextMobile.substring(0, currentIndexMobile));
          currentIndexMobile++;
        } else {
          clearInterval(typingIntervalMobile);
        }
      }, 80);
    };

    window.addEventListener("blinkCopyEvent", handleCopyEvent);
    return () => window.removeEventListener("blinkCopyEvent", handleCopyEvent);
  }, []);

  // Robust body scroll lock for mobile
  useEffect(() => {
    if (isMobileMenuOpen) {
      // Store current scroll position
      const scrollY = window.scrollY;

      // Apply scroll lock styles
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
      document.body.style.overflow = "hidden";

      return () => {
        // Restore scroll position
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        document.body.style.overflow = "";
        window.scrollTo(0, scrollY);
      };
    }
  }, [isMobileMenuOpen]);

  return (
    <ThemeProvider forcedTheme="dark" attribute="class">
      <div
        className={`public-layout bg-neutral-900 min-h-screen flex flex-col ${layGrotesk.className} ${layGrotesk.variable} ${geist.variable}`}
      >
        <div className="bg-[#090B0B] rounded-lg flex-1 flex flex-col">
          <div className="blink-navbar mobile-sticky-nav p-4 md:p-8 flex-row flex items-center max-w-7xl mx-auto z-50 w-full bg-[#090B0B]">
            <div className="shrink-0 flex items-center gap-3">
              <Link
                href="/"
                className="hover:opacity-80 transition-opacity duration-150"
              >
                <LogoBlink size={22} />
              </Link>
              {/* Mobile: Single line */}
              <a
                href="https://coder.com"
                target="_blank"
                rel="noopener noreferrer"
                className="md:hidden text-[13px] leading-[14px] text-gray-400 hover:text-gray-300 transition-colors duration-150"
              >
                {typedTextMobile}
              </a>
              {/* Desktop: Two lines */}
              <a
                href="https://coder.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden md:block text-[13px] leading-[14px] text-gray-400 hover:text-gray-300 transition-colors duration-150 min-h-[28px]"
              >
                <div>{typedText.split("\n")[0] || "\u00A0"}</div>
                <div>{typedText.split("\n")[1] || "\u00A0"}</div>
              </a>
            </div>

            {/* Navigation - Hidden on mobile, visible on large screens */}
            {/* <div className="hidden lg:flex flex-row items-center gap-6 text-neutral-400 ml-16">
              </div> */}

            {/* Mobile menu button */}
            <button
              className="lg:hidden ml-auto p-2 text-white hover:opacity-80 transition-opacity"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle mobile menu"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {isMobileMenuOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>

            {/* Auth buttons */}
            <div className="hidden lg:flex ml-auto flex-row items-center gap-1 md:gap-2">
              <a
                href="https://github.com/coder/blink"
                target="_blank"
                rel="noopener noreferrer"
                className="pl-2 text-gray-400 hover:text-white transition-colors duration-200"
                aria-label="GitHub"
              >
                <svg
                  className="w-5 h-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    fillRule="evenodd"
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                    clipRule="evenodd"
                  />
                </svg>
              </a>
              <a
                href="https://docs.blink.so"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-gray-400 hover:text-white transition-colors duration-200"
                aria-label="Documentation"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
              </a>
              <Link href="/login">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs md:text-sm px-4 rounded-full inline-flex items-center gap-2 border-gray-600 bg-gray-900/20 hover:bg-gray-800/30 hover:border-gray-500"
                >
                  Login
                </Button>
              </Link>
            </div>
          </div>

          {/* Mobile Navigation Menu */}
          {isMobileMenuOpen && (
            <div className="lg:hidden fixed inset-x-0 top-[72px] md:top-[104px] bottom-0 bg-[#090B0B] z-40 animate-in fade-in duration-200">
              <div className="h-full flex flex-col px-6 py-8 overflow-y-auto">
                <nav className="flex-1 flex flex-col space-y-2">
                  {/* <SmartNavLink
                      href="#use-cases"
                      className="text-gray-400 hover:text-white transition-colors py-3 text-lg font-medium"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Use Cases
                    </SmartNavLink>
                    <SmartNavLink
                      href="#features"
                      className="text-gray-400 hover:text-white transition-colors py-3 text-lg font-medium"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Features
                    </SmartNavLink>
                    <SmartNavLink
                      href="#how-it-works"
                      className="text-gray-400 hover:text-white transition-colors py-3 text-lg font-medium"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      How it Works
                    </SmartNavLink>

                    <SmartNavLink
                      href="#community"
                      className="text-gray-400 hover:text-white transition-colors py-3 text-lg font-medium"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      Community
                    </SmartNavLink> */}
                </nav>

                <div className="pb-8">
                  <Link
                    href="/login"
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <Button
                      variant="outline"
                      size="lg"
                      className="w-full text-base px-6 py-4 rounded-full inline-flex items-center justify-center gap-3 border-gray-600 bg-gray-900/20 hover:bg-gray-800/30 hover:border-gray-500"
                    >
                      Login
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          )}

          <div className="relative z-10 w-full flex flex-1 flex-col justify-center">
            {children}
          </div>

          <Footer />
        </div>
      </div>
    </ThemeProvider>
  );
}
