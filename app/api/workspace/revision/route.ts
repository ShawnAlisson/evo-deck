import { NextResponse } from "next/server";
import { z } from "zod";
import { workspaceSnapshotSchema } from "@/lib/workspace/snapshot";
import { requireWorkspaceAccess } from "@/lib/workspace/access";
import {
  appendRevision,
  getLatestRevision,
  getRevisionAtSeq,
} from "@/lib/workspace/timeline";

export const runtime = "nodejs";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  snapshot: workspaceSnapshotSchema.optional(),
  fromSeq: z.number().int().positive().optional(),
  label: z.string().optional(),
  /** Discard everything after this seq and make that frame the live head. */
  continueFromSeq: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    await requireWorkspaceAccess(body.workspaceId, "editor");

    const latest = await getLatestRevision(body.workspaceId);

    if (body.continueFromSeq != null) {
      const base = await getRevisionAtSeq(
        body.workspaceId,
        body.continueFromSeq,
      );
      if (!base) {
        return NextResponse.json(
          { error: "Revision not found" },
          { status: 404 },
        );
      }
      if (latest && body.continueFromSeq >= latest.seq) {
        return NextResponse.json({ revision: latest, alreadyLive: true });
      }

      const revision = await appendRevision({
        workspaceId: body.workspaceId,
        cause: "user_edit",
        snapshot: base.snapshot,
        fromSeq: body.continueFromSeq,
        label:
          body.label ??
          `Continued from #${body.continueFromSeq}${base.label ? ` (${base.label})` : ""}`,
      });
      return NextResponse.json({ revision });
    }

    if (!body.snapshot) {
      return NextResponse.json(
        { error: "snapshot is required" },
        { status: 400 },
      );
    }

    const revision = await appendRevision({
      workspaceId: body.workspaceId,
      cause: "user_edit",
      snapshot: body.snapshot,
      fromSeq:
        body.fromSeq != null && latest && body.fromSeq < latest.seq
          ? body.fromSeq
          : null,
      label: body.label ?? "Manual layout",
    });

    return NextResponse.json({ revision });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Update failed",
      },
      { status: 400 },
    );
  }
}
