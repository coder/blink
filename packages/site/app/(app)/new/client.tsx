"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Copy } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

const packageManagers: Array<{
  id: PackageManager;
  name: string;
  logo: string;
  installCommand: string;
}> = [
  {
    id: "bun",
    name: "Bun",
    logo: "/package-managers/bun.svg",
    installCommand: "bun i -g blink",
  },
  {
    id: "npm",
    name: "npm",
    logo: "/package-managers/npm.svg",
    installCommand: "npm i -g blink",
  },
  {
    id: "pnpm",
    name: "pnpm",
    logo: "/package-managers/pnpm.svg",
    installCommand: "pnpm add -g blink",
  },
  {
    id: "yarn",
    name: "Yarn",
    logo: "/package-managers/yarn.svg",
    installCommand: "yarn global add blink",
  },
];

export function NewPageClient({
  organizationName,
}: {
  organizationName: string;
}) {
  const [selectedPM, setSelectedPM] = useState<PackageManager>("bun");
  const [copiedInstall, setCopiedInstall] = useState(false);
  const [copiedInit, setCopiedInit] = useState(false);

  const installCommand =
    packageManagers.find((pm) => pm.id === selectedPM)?.installCommand ||
    "bun i -g blink";

  const handleCopy = async (text: string, setter: (val: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Button asChild variant="ghost" size="sm" className="mb-8">
        <Link href={`/${organizationName}`}>
          <ArrowLeft className="w-4 h-4" />
          Back to agents
        </Link>
      </Button>

      <div className="mb-12">
        <h1 className="text-2xl mb-2">Create a new agent</h1>
        <p className="text-muted-foreground">
          Use the Blink CLI to create and deploy agents from your terminal.
        </p>
      </div>

      <div className="space-y-8">
        <div>
          <div className="text-sm text-muted-foreground mb-3">
            Choose your package manager
          </div>
          <div className="flex gap-2 mb-6">
            {packageManagers.map((pm) => (
              <button
                key={pm.id}
                onClick={() => setSelectedPM(pm.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${
                  selectedPM === pm.id
                    ? "border-foreground bg-muted"
                    : "border-border hover:border-muted-foreground hover:bg-muted/50"
                }`}
              >
                <Image
                  src={pm.logo}
                  alt={pm.name}
                  width={20}
                  height={20}
                  className="shrink-0"
                />
                <span className="text-sm">{pm.name}</span>
              </button>
            ))}
          </div>

          <div className="text-sm text-muted-foreground mb-2">
            Install the CLI
          </div>
          <button
            onClick={() => handleCopy(installCommand, setCopiedInstall)}
            className="group flex items-center gap-3 px-4 py-3 bg-muted border border-border rounded-lg hover:bg-muted/80 transition-colors w-full justify-between"
          >
            <code className="font-mono text-sm">{installCommand}</code>
            {copiedInstall ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
          </button>
        </div>

        <div>
          <div className="text-sm text-muted-foreground mb-2">
            Initialize a new agent
          </div>
          <button
            onClick={() => handleCopy("blink init", setCopiedInit)}
            className="group flex items-center gap-3 px-4 py-3 bg-muted border border-border rounded-lg hover:bg-muted/80 transition-colors w-full justify-between"
          >
            <code className="font-mono text-sm">blink init</code>
            {copiedInit ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
          </button>
          <p className="text-sm text-muted-foreground mt-3">
            The CLI will guide you through creating your first agent, and
            deploying it to the cloud.
          </p>
        </div>
      </div>

      <div className="mt-12 pt-8 border-t border-border">
        <p className="text-sm text-muted-foreground">
          Need help getting started?{" "}
          <a
            href="https://docs.blink.so"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground hover:underline"
          >
            View the documentation
          </a>
        </p>
      </div>
    </div>
  );
}
