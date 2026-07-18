import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaceMembers } from "@/lib/db/schema";
import {
  createInvite,
  listInvites,
  listMembers,
  requireWorkspaceAccess,
} from "@/lib/workspace/access";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { membership } = await requireWorkspaceAccess(id, "viewer");
    const members = await listMembers(id);
    const invites =
      membership.role === "owner" ? await listInvites(id) : [];
    return NextResponse.json({ members, invites });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "editor", "viewer"]).default("editor"),
});

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { user } = await requireWorkspaceAccess(id, "owner");
    const body = inviteSchema.parse(await request.json());
    const invite = await createInvite({
      workspaceId: id,
      email: body.email,
      role: body.role,
      invitedBy: user.id,
    });

    const origin = new URL(request.url).origin;
    const inviteUrl = `${origin}/invite/${invite.token}`;

    return NextResponse.json({ invite, inviteUrl });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invite failed" },
      { status: 400 },
    );
  }
}

const removeSchema = z.object({
  userId: z.string().uuid(),
});

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { user } = await requireWorkspaceAccess(id, "owner");
    const body = removeSchema.parse(await request.json());

    if (body.userId === user.id) {
      return NextResponse.json(
        { error: "Owners cannot remove themselves" },
        { status: 400 },
      );
    }

    const members = await listMembers(id);
    const target = members.find((m) => m.userId === body.userId);

    if (!target) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (target.role === "owner") {
      const ownerCount = members.filter((m) => m.role === "owner").length;
      if (ownerCount <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the last owner" },
          { status: 400 },
        );
      }
    }

    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, body.userId),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remove failed" },
      { status: 400 },
    );
  }
}
