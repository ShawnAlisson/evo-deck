import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createScenarioBranch,
  listTimelineBranches,
} from "@/lib/workspace/timeline";
import { requireWorkspaceAccess } from "@/lib/workspace/access";

export const runtime = "nodejs";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200),
  fromSeq: z.number().int().positive(),
  parentBranchId: z.string().uuid().nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId required" },
        { status: 400 },
      );
    }
    await requireWorkspaceAccess(workspaceId, "viewer");
    const branches = await listTimelineBranches(workspaceId);
    return NextResponse.json({ branches });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "List failed" },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    await requireWorkspaceAccess(body.workspaceId, "editor");
    const scenario = await createScenarioBranch({
      workspaceId: body.workspaceId,
      fromSeq: body.fromSeq,
      name: body.name,
      parentBranchId: body.parentBranchId ?? null,
    });
    if (!scenario) {
      return NextResponse.json(
        { error: "The selected frame is not on this timeline path" },
        { status: 409 },
      );
    }
    return NextResponse.json(scenario, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Branch failed" },
      { status: 400 },
    );
  }
}
