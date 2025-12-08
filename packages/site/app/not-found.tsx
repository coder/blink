import { LogoBlink } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Page Not Found - Blink",
  description: "The page you're looking for could not be found.",
};

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#090B0B] flex items-center justify-center px-4">
      <div className="text-center max-w-md mx-auto">
        {/* Blink Logo */}
        <div className="flex justify-center mb-8">
          <LogoBlink size={24} className="text-white" />
        </div>

        {/* 404 Text */}
        <div className="mb-6">
          <h1 className="text-6xl font-bold text-white mb-2">404</h1>
          <h2 className="text-2xl font-semibold text-gray-300 mb-4">
            Page Not Found
          </h2>
        </div>

        {/* Action Button */}
        <div className="flex flex-col items-center gap-4">
          <Button asChild className="bg-white text-black hover:bg-white/90">
            <Link href="https://blink.so/">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
