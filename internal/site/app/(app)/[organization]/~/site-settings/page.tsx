import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization: organizationName } = await params;
  redirect(`/${organizationName}/~/site-settings/users`);
}
