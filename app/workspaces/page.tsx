import { WorkspacesDashboard } from "@/components/workspaces/dashboard";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function WorkspacesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <WorkspacesDashboard />;
}
