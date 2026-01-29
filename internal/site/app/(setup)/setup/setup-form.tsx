import { LogoBlink } from "@/components/icons";

import { SignupForm } from "../../(public)/signup/form";

interface SetupFormProps {
  redirect?: string;
  error?: string;
}

export function SetupForm({ redirect, error }: SetupFormProps) {
  return (
    <div className="w-full max-w-md p-4">
      {/* Logo */}
      <div className="flex justify-center mb-8">
        <LogoBlink size={48} hideText />
      </div>

      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl text-white mb-2">
          Welcome to <span className="font-bold">Blink</span>
        </h1>
        <p className="text-neutral-400">
          Let's create your first admin account
        </p>
      </div>

      {/* Card */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-700 shadow-lg p-8">
        {/* Error Display */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-200">{error}</p>
          </div>
        )}

        {/* Email/Password Signup Form */}
        <SignupForm redirect={redirect} />
      </div>

      {/* Copyright */}
      <p className="text-center text-xs text-neutral-500 mt-8">
        © {new Date().getFullYear()} Coder Technologies, Inc.
      </p>
    </div>
  );
}
