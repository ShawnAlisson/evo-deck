import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createTimelineBranch,
  getWorkspace,
  listTimelineBranches,
} from "@/lib/workspace/timeline";
import { requireWorkspaceAccess } from "@/lib/workspace/access";

export const runtime = "nodejs";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200),
  fromSeq: z.number().int().positive(),
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
    const workspace = await getWorkspace(body.workspaceId);
    if (!workspace) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const branch = await createTimelineBranch(body);
    return NextResponse.json({ branch });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Branch failed" },
      { status: 400 },
    );
  }
}
