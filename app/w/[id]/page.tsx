import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export default async function WorkspacePage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await params;
  return <WorkspaceShell />;
}
