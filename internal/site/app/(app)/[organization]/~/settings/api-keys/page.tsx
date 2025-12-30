import { auth } from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApiKeysManager } from "./api-keys-manager";

export const metadata: Metadata = {
  title: "API Keys - Settings - Blink",
  description: "Manage your API keys for programmatic access.",
};

export default async function ApiKeysPage() {
  const session = await auth();
  if (!session || !session.user?.id) {
    redirect("/");
  }

  return (
    <div className="space-y-6">
      <ApiKeysManager userId={session.user.id} />
    </div>
  );
}
