import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  chatMessages,
  integrations,
  timelineBranches,
  workspaceRevisions,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import {
  emptySnapshot,
  normalizeSnapshot,
  type WorkspaceSnapshot,
  workspaceSnapshotSchema,
} from "@/lib/workspace/snapshot";

export type RevisionCause = "chat" | "user_edit" | "system";

function branchScope<T extends { workspaceId: unknown; branchId: unknown }>(
  table: T,
  workspaceId: string,
  branchId: string | null,
) {
  return branchId
    ? and(
        eq(table.workspaceId as never, workspaceId),
        eq(table.branchId as never, branchId),
      )
    : and(eq(table.workspaceId as never, workspaceId), isNull(table.branchId as never));
}

export async function getWorkspace(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listRevisions(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceRevisions)
    .where(eq(workspaceRevisions.workspaceId, workspaceId))
    .orderBy(asc(workspaceRevisions.seq));

  return rows.map((row) => ({
    ...row,
    snapshot: workspaceSnapshotSchema.parse(row.snapshot),
  }));
}

export async function getLatestRevision(
  workspaceId: string,
  branchId: string | null = null,
) {
  const rows = await db
    .select()
    .from(workspaceRevisions)
    .where(branchScope(workspaceRevisions, workspaceId, branchId))
    .orderBy(desc(workspaceRevisions.seq))
    .limit(1);

  if (!rows[0]) return null;
  return {
    ...rows[0],
    snapshot: workspaceSnapshotSchema.parse(rows[0].snapshot),
  };
}

export async function getRevisionAtSeq(workspaceId: string, seq: number) {
  const rows = await db
    .select()
    .from(workspaceRevisions)
    .where(
      and(
        eq(workspaceRevisions.workspaceId, workspaceId),
        eq(workspaceRevisions.seq, seq),
      ),
    )
    .limit(1);

  if (!rows[0]) return null;
  return {
    ...rows[0],
    snapshot: workspaceSnapshotSchema.parse(rows[0].snapshot),
  };
}

export async function appendRevision(input: {
  workspaceId: string;
  /** Null writes to the main timeline; a branch id writes to that scenario. */
  branchId?: string | null;
  cause: RevisionCause;
  snapshot: WorkspaceSnapshot;
  messageId?: string | null;
  label?: string | null;
}) {
  const snapshot = workspaceSnapshotSchema.parse(input.snapshot);
  const messageId =
    input.messageId && input.messageId.length > 0 ? input.messageId : null;

  return db.transaction(async (tx) => {
    // Serialize revisions per workspace to avoid duplicate seq races
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId}))`,
    );

    const latestRows = await tx
      .select({ seq: workspaceRevisions.seq })
      .from(workspaceRevisions)
      .where(eq(workspaceRevisions.workspaceId, input.workspaceId))
      .orderBy(desc(workspaceRevisions.seq))
      .limit(1);

    // Timelines are append-only. Sequences remain global within a workspace so
    // a branch can point to one unambiguous inherited frame.
    const nextSeq = (latestRows[0]?.seq ?? 0) + 1;

    const [revision] = await tx
      .insert(workspaceRevisions)
      .values({
        workspaceId: input.workspaceId,
        branchId: input.branchId ?? null,
        seq: nextSeq,
        cause: input.cause,
        messageId,
        snapshot,
        label: input.label ?? null,
      })
      .returning();

    await tx
      .update(workspaces)
      .set({ updatedAt: sql`now()` })
      .where(eq(workspaces.id, input.workspaceId));

    return {
      ...revision,
      snapshot,
    };
  });
}

export async function createWorkspace(input?: {
  title?: string;
  ownerId?: string | null;
  seedSnapshot?: WorkspaceSnapshot;
}) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      title: input?.title ?? "EvoDeck",
      ownerId: input?.ownerId ?? null,
    })
    .returning();

  const snapshot = input?.seedSnapshot ?? emptySnapshot();
  const revision = await appendRevision({
    workspaceId: workspace.id,
    cause: "system",
    snapshot,
    label: "Origin",
  });

  return { workspace, revision };
}

/** Create an independent copy of a workspace, including its editable history. */
export async function duplicateWorkspace(input: {
  sourceWorkspaceId: string;
  ownerId: string;
  title: string;
}) {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, input.sourceWorkspaceId))
      .limit(1);

    if (!source) return null;

    const [workspace] = await tx
      .insert(workspaces)
      .values({ title: input.title, ownerId: input.ownerId })
      .returning();

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: input.ownerId,
      role: "owner",
    });

    const branches = await tx
      .select()
      .from(timelineBranches)
      .where(eq(timelineBranches.workspaceId, source.id));
    const branchIds = new Map<string, string>();

    for (const branch of branches) {
      const [copy] = await tx
        .insert(timelineBranches)
        .values({
          workspaceId: workspace.id,
          name: branch.name,
          fromSeq: branch.fromSeq,
          parentBranchId: null,
          createdAt: branch.createdAt,
        })
        .returning({ id: timelineBranches.id });
      branchIds.set(branch.id, copy.id);
    }

    for (const branch of branches) {
      if (!branch.parentBranchId) continue;
      const branchId = branchIds.get(branch.id);
      const parentBranchId = branchIds.get(branch.parentBranchId);
      if (branchId && parentBranchId) {
        await tx
          .update(timelineBranches)
          .set({ parentBranchId })
          .where(eq(timelineBranches.id, branchId));
      }
    }

    const messages = await tx
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.workspaceId, source.id))
      .orderBy(asc(chatMessages.createdAt));
    const messageIds = new Map<string, string>();

    for (const message of messages) {
      const [copy] = await tx
        .insert(chatMessages)
        .values({
          workspaceId: workspace.id,
          branchId: message.branchId
            ? (branchIds.get(message.branchId) ?? null)
            : null,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        })
        .returning({ id: chatMessages.id });
      messageIds.set(message.id, copy.id);
    }

    const revisions = await tx
      .select()
      .from(workspaceRevisions)
      .where(eq(workspaceRevisions.workspaceId, source.id))
      .orderBy(asc(workspaceRevisions.seq));
    if (revisions.length > 0) {
      await tx.insert(workspaceRevisions).values(
        revisions.map((revision) => ({
          workspaceId: workspace.id,
          branchId: revision.branchId
            ? (branchIds.get(revision.branchId) ?? null)
            : null,
          seq: revision.seq,
          cause: revision.cause,
          messageId: revision.messageId
            ? (messageIds.get(revision.messageId) ?? null)
            : null,
          snapshot: normalizeSnapshot(
            workspaceSnapshotSchema.parse(revision.snapshot),
          ),
          label: revision.label,
          createdAt: revision.createdAt,
        })),
      );
    }

    const sourceIntegrations = await tx
      .select()
      .from(integrations)
      .where(eq(integrations.workspaceId, source.id));
    if (sourceIntegrations.length > 0) {
      await tx.insert(integrations).values(
        sourceIntegrations.map((integration) => ({
          workspaceId: workspace.id,
          type: integration.type,
          config: integration.config,
          status: integration.status,
          createdAt: integration.createdAt,
          updatedAt: integration.updatedAt,
        })),
      );
    }

    return workspace;
  });
}

export async function listMessages(
  workspaceId: string,
  branchId: string | null = null,
) {
  return db
    .select()
    .from(chatMessages)
    .where(branchScope(chatMessages, workspaceId, branchId))
    .orderBy(asc(chatMessages.createdAt));
}

export async function addMessage(input: {
  workspaceId: string;
  branchId?: string | null;
  role: "user" | "assistant" | "system";
  content: string;
}) {
  const [message] = await db
    .insert(chatMessages)
    .values({
      workspaceId: input.workspaceId,
      branchId: input.branchId ?? null,
      role: input.role,
      content: input.content,
    })
    .returning();
  return message;
}

/**
 * Add a selectable, in-workspace timeline branch. The first branch revision
 * copies the fork-point snapshot so it is immediately a writable live head.
 */
export async function createScenarioBranch(input: {
  workspaceId: string;
  name: string;
  fromSeq: number;
  parentBranchId?: string | null;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId}))`,
    );

    const [forkPoint] = await tx
      .select()
      .from(workspaceRevisions)
      .where(
        and(
          eq(workspaceRevisions.workspaceId, input.workspaceId),
          eq(workspaceRevisions.seq, input.fromSeq),
        ),
      )
      .limit(1);
    if (!forkPoint) return null;

    if (input.parentBranchId) {
      const branchPath = await tx
        .select({
          id: timelineBranches.id,
          fromSeq: timelineBranches.fromSeq,
          parentBranchId: timelineBranches.parentBranchId,
        })
        .from(timelineBranches)
        .where(eq(timelineBranches.workspaceId, input.workspaceId));
      const byId = new Map(branchPath.map((branch) => [branch.id, branch]));
      let current = byId.get(input.parentBranchId);
      let isOnPath = false;

      // A selected branch contains all of its own revisions, plus each
      // ancestor only through the exact fork frame. This validates the same
      // path the client renders and rejects accidental sibling attachments.
      while (current) {
        if (forkPoint.branchId === current.id) {
          isOnPath = true;
          break;
        }
        if (forkPoint.seq > current.fromSeq) break;
        if (!current.parentBranchId) {
          isOnPath = forkPoint.branchId == null;
          break;
        }
        current = byId.get(current.parentBranchId);
      }
      if (!isOnPath) return null;
    } else if (forkPoint.branchId != null) {
      // A branch must explicitly identify the branch being viewed, so a
      // client cannot attach a scenario to an unrelated frame.
      return null;
    }

    const name = input.name.trim().slice(0, 200) || "Scenario";
    const [branch] = await tx
      .insert(timelineBranches)
      .values({
        workspaceId: input.workspaceId,
        name,
        fromSeq: input.fromSeq,
        parentBranchId: input.parentBranchId ?? null,
      })
      .returning();

    const latestRows = await tx
      .select({ seq: workspaceRevisions.seq })
      .from(workspaceRevisions)
      .where(eq(workspaceRevisions.workspaceId, input.workspaceId))
      .orderBy(desc(workspaceRevisions.seq))
      .limit(1);
    const snapshot = normalizeSnapshot(
      workspaceSnapshotSchema.parse(forkPoint.snapshot),
    );
    const [revision] = await tx
      .insert(workspaceRevisions)
      .values({
        workspaceId: input.workspaceId,
        branchId: branch.id,
        seq: (latestRows[0]?.seq ?? 0) + 1,
        cause: "system",
        snapshot,
        label: `Scenario · ${name}`,
      })
      .returning();

    await tx
      .update(workspaces)
      .set({ updatedAt: sql`now()` })
      .where(eq(workspaces.id, input.workspaceId));

    return { branch, revision: { ...revision, snapshot } };
  });
}

export async function listTimelineBranches(workspaceId: string) {
  return db
    .select()
    .from(timelineBranches)
    .where(eq(timelineBranches.workspaceId, workspaceId))
    .orderBy(desc(timelineBranches.createdAt));
}

export async function getTimelineBranch(
  workspaceId: string,
  branchId: string,
) {
  const rows = await db
    .select()
    .from(timelineBranches)
    .where(
      and(
        eq(timelineBranches.workspaceId, workspaceId),
        eq(timelineBranches.id, branchId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
