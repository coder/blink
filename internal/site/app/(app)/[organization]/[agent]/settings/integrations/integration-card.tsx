"use client";

import { Check, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface IntegrationCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  iconBgColor: string;
  configured: boolean;
  onConfigure: () => void;
}

export function IntegrationCard({
  title,
  description,
  icon,
  iconBgColor,
  configured,
  onConfigure,
}: IntegrationCardProps) {
  return (
    <Card>
      <CardHeader className="p-4">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconBgColor}`}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="text-sm truncate">
              {description}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {configured ? (
              <>
                <div className="flex items-center gap-1.5 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  <span className="hidden sm:inline">Connected</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onConfigure}
                  className="h-8 w-8"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" onClick={onConfigure}>
                <Plus className="mr-1.5 h-4 w-4" />
                Configure
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
