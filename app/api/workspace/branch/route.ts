import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createTimelineBranch,
  getWorkspace,
  listTimelineBranches,
} from "@/lib/workspace/timeline";

export const runtime = "nodejs";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(200),
  fromSeq: z.number().int().positive(),
});

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }
  const branches = await listTimelineBranches(workspaceId);
  return NextResponse.json({ branches });
}

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const workspace = await getWorkspace(body.workspaceId);
    if (!workspace) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const branch = await createTimelineBranch(body);
    return NextResponse.json({ branch });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Branch failed" },
      { status: 400 },
    );
  }
}
