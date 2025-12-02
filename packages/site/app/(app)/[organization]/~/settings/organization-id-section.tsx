"use client";

import { Input } from "@/components/ui/input";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function OrganizationIdSection({
  organizationId,
}: {
  organizationId: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <label
        htmlFor="organization_id"
        className="text-sm font-medium text-foreground"
      >
        Organization ID
      </label>
      <p className="text-sm text-muted-foreground">Use for support requests.</p>
      <div className="relative">
        <Input
          id="organization_id"
          value={organizationId}
          readOnly
          className="font-mono pr-10"
        />
        <button
          type="button"
          aria-label="Copy organization ID"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(organizationId);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {}
          }}
          className="absolute inset-y-0 right-1 my-1 px-2 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
