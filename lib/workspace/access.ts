import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { randomBytes } from "crypto";

export type MemberRole = "owner" | "editor" | "viewer";

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

export async function getMembership(workspaceId: string, userId: string) {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function requireWorkspaceAccess(
  workspaceId: string,
  minRole: MemberRole = "viewer",
) {
  const user = await requireUser();
  const membership = await getMembership(workspaceId, user.id);
  if (!membership) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rank = { viewer: 1, editor: 2, owner: 3 } as const;
  if (rank[membership.role] < rank[minRole]) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { user, membership };
}

export async function listUserWorkspaces(userId: string) {
  return db
    .select({
      id: workspaces.id,
      title: workspaces.title,
      ownerId: workspaces.ownerId,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(sql`${workspaces.updatedAt} desc`);
}

export async function addWorkspaceOwner(workspaceId: string, userId: string) {
  await db
    .insert(workspaceMembers)
    .values({
      workspaceId,
      userId,
      role: "owner",
    })
    .onConflictDoNothing({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
    });
}

export async function createInvite(input: {
  workspaceId: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
}) {
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
  const email = input.email.toLowerCase();

  const existing = await db
    .select()
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, input.workspaceId),
        eq(workspaceInvites.email, email),
      ),
    )
    .limit(1);

  if (existing[0] && !existing[0].acceptedAt) {
    const [updated] = await db
      .update(workspaceInvites)
      .set({
        token,
        role: input.role,
        invitedBy: input.invitedBy,
        expiresAt,
      })
      .where(eq(workspaceInvites.id, existing[0].id))
      .returning();
    return updated;
  }

  const [invite] = await db
    .insert(workspaceInvites)
    .values({
      workspaceId: input.workspaceId,
      email,
      role: input.role,
      token,
      invitedBy: input.invitedBy,
      expiresAt,
    })
    .returning();
  return invite;
}

export async function listMembers(workspaceId: string) {
  return db
    .select({
      id: workspaceMembers.id,
      role: workspaceMembers.role,
      userId: users.id,
      email: users.email,
      name: users.name,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
}

export async function listInvites(workspaceId: string) {
  return db
    .select()
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspaceId),
        sql`${workspaceInvites.acceptedAt} is null`,
      ),
    );
}

export async function acceptInvite(token: string, userId: string, email: string) {
  const rows = await db
    .select()
    .from(workspaceInvites)
    .where(eq(workspaceInvites.token, token))
    .limit(1);
  const invite = rows[0];
  if (!invite || invite.acceptedAt) {
    throw new Error("Invite not found");
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new Error("Invite expired");
  }
  if (invite.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error("Invite email does not match your account");
  }

  await db
    .insert(workspaceMembers)
    .values({
      workspaceId: invite.workspaceId,
      userId,
      role: invite.role,
    })
    .onConflictDoNothing({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
    });

  await db
    .update(workspaceInvites)
    .set({ acceptedAt: sql`now()` })
    .where(eq(workspaceInvites.id, invite.id));

  return invite;
}

export async function getWorkspaceForUser(workspaceId: string, userId: string) {
  const rows = await db
    .select({
      workspace: workspaces,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}
