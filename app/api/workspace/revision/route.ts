import { NextResponse } from "next/server";
import { z } from "zod";
import { workspaceSnapshotSchema } from "@/lib/workspace/snapshot";
import { requireWorkspaceAccess } from "@/lib/workspace/access";
import {
  appendRevision,
  getLatestRevision,
  getTimelineBranch,
} from "@/lib/workspace/timeline";

export const runtime = "nodejs";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  snapshot: workspaceSnapshotSchema.optional(),
  fromSeq: z.number().int().positive().optional(),
  label: z.string().optional(),
  /** Legacy field retained for old clients; historical edits are no longer destructive. */
  continueFromSeq: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    await requireWorkspaceAccess(body.workspaceId, "editor");
    const branchId = body.branchId ?? null;
    if (branchId && !(await getTimelineBranch(body.workspaceId, branchId))) {
      return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    }

    const latest = await getLatestRevision(body.workspaceId, branchId);

    if (body.continueFromSeq != null) {
      return NextResponse.json(
        {
          error:
            "Historical frames are read-only. Create a scenario to explore an alternate future.",
        },
        { status: 409 },
      );
    }

    if (!body.snapshot) {
      return NextResponse.json(
        { error: "snapshot is required" },
        { status: 400 },
      );
    }

    if (body.fromSeq != null && latest && body.fromSeq < latest.seq) {
      return NextResponse.json(
        {
          error:
            "This is a historical frame. Create a scenario before changing it.",
        },
        { status: 409 },
      );
    }

    const revision = await appendRevision({
      workspaceId: body.workspaceId,
      branchId,
      cause: "user_edit",
      snapshot: body.snapshot,
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
