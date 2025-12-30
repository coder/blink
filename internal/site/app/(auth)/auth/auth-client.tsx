"use client";

import { LogoBlink } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Client from "@blink.so/api";
import { AlertTriangle, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AuthPageClientProps {
  id: string;
}

export default function AuthPageClient({ id }: AuthPageClientProps) {
  const router = useRouter();
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuthorize = async () => {
    setIsAuthorizing(true);
    setError(null);

    try {
      const client = new Client();
      const response = await client.request(
        "POST",
        "/api/auth/token",
        JSON.stringify({ id })
      );

      if (response.ok) {
        router.push(`/auth/success?id=${id}`);
      } else {
        throw new Error("Authorization failed");
      }
    } catch (err) {
      setError("Failed to authorize. Please try again.");
      console.error("Authorization error:", err);
    } finally {
      setIsAuthorizing(false);
    }
  };

  const handleCancel = () => {
    router.push("https://blink.so");
  };

  return (
    <div className="min-h-screen flex justify-center p-4">
      <div className="w-full max-w-md space-y-6 pt-32">
        {/* Header with Blink icons */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center border border-border">
            <LogoBlink size={24} hideText={true} className="text-foreground" />
          </div>
          <div className="flex items-center">
            <div className="w-8 h-0.5 bg-border"></div>
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mx-2">
              <Check className="w-4 h-4 text-white" />
            </div>
            <div className="w-8 h-0.5 bg-border"></div>
          </div>
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center border border-border">
            <LogoBlink size={24} hideText={true} className="text-foreground" />
          </div>
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-medium text-foreground mb-4">
            Authorize Blink CLI
          </h1>
        </div>

        {/* Warning card */}
        <Card className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-yellow-800 dark:text-yellow-200">
                <p>
                  Make sure you trust this device as it will get access to your
                  account.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main authorization card */}
        <Card>
          <CardContent className="space-y-6 p-4">
            <div>
              <h3 className="text-lg font-semibold mb-4">Access</h3>
              <div className="space-y-3">
                {[
                  "Full control of chats",
                  "Full control of agents",
                  "Full control of organizations",
                ].map((permission, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span className="text-sm text-muted-foreground">
                      {permission}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <Button
                onClick={handleCancel}
                variant="outline"
                className="flex-1"
                disabled={isAuthorizing}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAuthorize}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                disabled={isAuthorizing}
              >
                {isAuthorizing ? "Authorizing..." : "Authorize Blink"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
