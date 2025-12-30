import { auth } from "@/app/(auth)/auth";
import { redirect } from "next/navigation";
import AuthPageClient from "./auth-client";

interface AuthPageProps {
  searchParams: {
    id?: string;
  };
}

export default async function AuthPage({ searchParams }: AuthPageProps) {
  const session = await auth();
  const { id } = await searchParams;

  // If no ID is provided, redirect to home
  if (!id) {
    redirect("https://blink.so");
  }

  // If user is not authenticated, redirect to login with callback URL
  if (!session?.user?.id) {
    const callbackUrl = `/auth?id=${encodeURIComponent(id)}`;
    redirect(`/login?redirect=${encodeURIComponent(callbackUrl)}`);
  }

  // User is authenticated, render the authorization page
  return <AuthPageClient id={id} />;
}
