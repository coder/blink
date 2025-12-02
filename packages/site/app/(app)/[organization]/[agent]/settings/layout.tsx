import { PageContainer } from "@/components/page-header";
import { AgentSettingsNav } from "./navigation";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageContainer>
      <AgentSettingsNav />
      {children}
    </PageContainer>
  );
}
