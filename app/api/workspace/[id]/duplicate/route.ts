import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addWorkspaceOwner,
  requireWorkspaceAccess,
} from "@/lib/workspace/access";
import { duplicateWorkspace, getWorkspace } from "@/lib/workspace/timeline";

export const runtime = "nodejs";

const duplicateBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user } = await requireWorkspaceAccess(id, "viewer");
    const source = await getWorkspace(id);
    if (!source) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = duplicateBody.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid title" }, { status: 400 });
    }

    const title = (parsed.data.title ?? `${source.title} copy`).slice(0, 200);
    const workspace = await duplicateWorkspace({
      sourceWorkspaceId: id,
      ownerId: user.id,
      title,
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    // Keep ownership membership explicit and idempotent, matching normal creation.
    await addWorkspaceOwner(workspace.id, user.id);
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Duplicate workspace failed", error);
    return NextResponse.json(
      { error: "Failed to duplicate workspace" },
      { status: 500 },
    );
  }
}
