import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="w-full bg-[#090B0B]">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Coder Logo - Hidden on mobile */}
          <a
            href="https://coder.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <span className="text-gray-400 dark:text-gray-500 text-sm">
              Built by
            </span>
            <Image
              src="/coder-logo-white.svg"
              alt="Coder"
              width={106}
              height={17}
              className="h-[18px] w-auto"
            />
          </a>

          {/* Links - Centered and stacked on mobile */}
          <div className="flex flex-col md:flex-row items-center gap-4 md:gap-6 text-sm text-center">
            <Link
              href="/privacy"
              className="text-gray-400 dark:text-gray-500 hover:text-white dark:hover:text-white transition-colors"
            >
              Privacy Policy
            </Link>
            <Link
              href="/terms"
              className="text-gray-400 dark:text-gray-500 hover:text-white dark:hover:text-white transition-colors"
            >
              Terms of Use
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
