import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptInvite } from "@/lib/workspace/access";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceInvites, workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  const rows = await db
    .select({
      invite: workspaceInvites,
      workspaceTitle: workspaces.title,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .where(eq(workspaceInvites.token, token))
    .limit(1);

  const row = rows[0];
  if (!row || row.invite.acceptedAt) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }
  return NextResponse.json({
    email: row.invite.email,
    role: row.invite.role,
    workspaceTitle: row.workspaceTitle,
    workspaceId: row.invite.workspaceId,
    expiresAt: row.invite.expiresAt,
  });
}

const bodySchema = z.object({ token: z.string().min(10) });

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const body = bodySchema.parse(await request.json());
    const invite = await acceptInvite(body.token, user.id, user.email);
    return NextResponse.json({
      workspaceId: invite.workspaceId,
      role: invite.role,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Accept failed" },
      { status: 400 },
    );
  }
}
