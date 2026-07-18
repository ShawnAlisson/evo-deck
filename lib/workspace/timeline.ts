import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
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

export async function getLatestRevision(workspaceId: string) {
  const rows = await db
    .select()
    .from(workspaceRevisions)
    .where(eq(workspaceRevisions.workspaceId, workspaceId))
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

/** Truncate forward (like undo history) when editing from a past playhead. */
export async function truncateForward(workspaceId: string, afterSeq: number) {
  await db
    .delete(workspaceRevisions)
    .where(
      and(
        eq(workspaceRevisions.workspaceId, workspaceId),
        gt(workspaceRevisions.seq, afterSeq),
      ),
    );
}

export async function appendRevision(input: {
  workspaceId: string;
  cause: RevisionCause;
  snapshot: WorkspaceSnapshot;
  messageId?: string | null;
  label?: string | null;
  /** If set, truncate revisions after this seq before appending. */
  fromSeq?: number | null;
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

    const latestSeq = latestRows[0]?.seq ?? 0;

    // Only truncate when editing from a past playhead (not when appending at head)
    if (input.fromSeq != null && input.fromSeq < latestSeq) {
      await tx
        .delete(workspaceRevisions)
        .where(
          and(
            eq(workspaceRevisions.workspaceId, input.workspaceId),
            gt(workspaceRevisions.seq, input.fromSeq),
          ),
        );
    }

    const afterTruncate = await tx
      .select({ seq: workspaceRevisions.seq })
      .from(workspaceRevisions)
      .where(eq(workspaceRevisions.workspaceId, input.workspaceId))
      .orderBy(desc(workspaceRevisions.seq))
      .limit(1);

    const nextSeq = (afterTruncate[0]?.seq ?? 0) + 1;

    const [revision] = await tx
      .insert(workspaceRevisions)
      .values({
        workspaceId: input.workspaceId,
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

    const branches = await tx
      .select()
      .from(timelineBranches)
      .where(eq(timelineBranches.workspaceId, source.id));
    if (branches.length > 0) {
      await tx.insert(timelineBranches).values(
        branches.map((branch) => ({
          workspaceId: workspace.id,
          name: branch.name,
          fromSeq: branch.fromSeq,
          createdAt: branch.createdAt,
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

export async function listMessages(workspaceId: string) {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.workspaceId, workspaceId))
    .orderBy(asc(chatMessages.createdAt));
}

export async function addMessage(input: {
  workspaceId: string;
  role: "user" | "assistant" | "system";
  content: string;
}) {
  const [message] = await db
    .insert(chatMessages)
    .values({
      workspaceId: input.workspaceId,
      role: input.role,
      content: input.content,
    })
    .returning();
  return message;
}

export async function createTimelineBranch(input: {
  workspaceId: string;
  name: string;
  fromSeq: number;
}) {
  const [branch] = await db
    .insert(timelineBranches)
    .values({
      workspaceId: input.workspaceId,
      name: input.name,
      fromSeq: input.fromSeq,
    })
    .returning();
  return branch;
}

export async function listTimelineBranches(workspaceId: string) {
  return db
    .select()
    .from(timelineBranches)
    .where(eq(timelineBranches.workspaceId, workspaceId))
    .orderBy(desc(timelineBranches.createdAt));
}
