import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import {
  getWorkspaceForUser,
  listInvites,
  listMembers,
  requireWorkspaceAccess,
} from "@/lib/workspace/access";
import {
  listMessages,
  listRevisions,
  listTimelineBranches,
} from "@/lib/workspace/timeline";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { user, membership } = await requireWorkspaceAccess(id, "viewer");
    const access = await getWorkspaceForUser(id, user.id);
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [revisions, messages, branches, members, invites] = await Promise.all([
      listRevisions(id),
      listMessages(id),
      listTimelineBranches(id),
      listMembers(id),
      membership.role === "owner" ? listInvites(id) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      workspace: access.workspace,
      role: membership.role,
      revisions,
      messages,
      branches,
      members,
      invites,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 400 },
    );
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, "owner");
    const body = patchSchema.parse(await request.json());
    const [workspace] = await db
      .update(workspaces)
      .set({ title: body.title, updatedAt: new Date() })
      .where(eq(workspaces.id, id))
      .returning();
    return NextResponse.json({ workspace });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rename failed" },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, "owner");
    await db.delete(workspaces).where(eq(workspaces.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 400 },
    );
  }
}
