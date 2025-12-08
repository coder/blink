"use client";

import { LogoBlink } from "@/components/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Check } from "lucide-react";

export default function AuthSuccessPage() {
  return (
    <div className="min-h-screen flex justify-center p-4">
      <div className="w-full max-w-md space-y-6 pt-32">
        {/* Header with Blink icons */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center border border-border">
            <LogoBlink size={24} hideText={true} className="text-foreground" />
          </div>
          <div className="flex items-center">
            <div className="w-8 h-0.5 bg-green-500"></div>
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mx-2">
              <Check className="w-4 h-4 text-white" />
            </div>
            <div className="w-8 h-0.5 bg-green-500"></div>
          </div>
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center border border-border">
            <LogoBlink size={24} hideText={true} className="text-foreground" />
          </div>
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-medium text-foreground mb-4">
            You're all set!
          </h1>
        </div>

        {/* Success card */}
        <Card>
          <CardContent className="space-y-6 p-20">
            <div className="text-center space-y-6">
              <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-white" />
              </div>

              <div>
                <p className="text-muted-foreground">
                  Your device is now authenticated. Return to your terminal.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
