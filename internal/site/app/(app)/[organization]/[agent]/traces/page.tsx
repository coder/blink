import { auth } from "@/app/(auth)/auth";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAgent, getOrganization } from "../../layout";
import TracesList from "./list";

export async function generateMetadata(props: {
  params: Promise<{ organization: string; agent: string }>;
}): Promise<Metadata> {
  const session = await auth();
  const { organization, agent } = await props.params;
  if (!session?.user?.id) {
    return { title: "Blink" };
  }
  const [org, ag] = await Promise.all([
    getOrganization(session.user.id, organization),
    getAgent(organization, agent),
  ]);
  return { title: `Traces · ${ag.name} · ${org.name} - Blink` };
}

export default async function TracesPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string; agent: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session || !session?.user?.id) {
    return redirect("/login");
  }
  const userID = session.user.id;
  const { organization: organizationName, agent: agentName } = await params;
  const search = await searchParams;
  const [organization, agent] = await Promise.all([
    getOrganization(userID, organizationName),
    getAgent(organizationName, agentName),
  ]);

  // Check permission - traces require write or admin access
  const permission = agent.user_permission ?? "read";
  if (permission !== "write" && permission !== "admin") {
    notFound();
  }

  // Parse filters from query params
  let initialFilters = undefined;
  if (search.filters && typeof search.filters === "string") {
    try {
      initialFilters = JSON.parse(search.filters);
    } catch (error) {
      console.error("Failed to parse filters from query params:", error);
    }
  }

  // Parse start_time and end_time from query params
  let initialStartTime = undefined;
  let initialEndTime = undefined;
  if (search.start_time && typeof search.start_time === "string") {
    try {
      initialStartTime = new Date(search.start_time);
    } catch (error) {
      console.error("Failed to parse start_time from query params:", error);
    }
  }
  if (search.end_time && typeof search.end_time === "string") {
    try {
      initialEndTime = new Date(search.end_time);
    } catch (error) {
      console.error("Failed to parse end_time from query params:", error);
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-y-hidden">
      <TracesList
        agentId={agent.id}
        initialFilters={initialFilters}
        initialStartTime={initialStartTime}
        initialEndTime={initialEndTime}
      />
    </div>
  );
}
