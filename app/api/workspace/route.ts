import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  addWorkspaceOwner,
  listUserWorkspaces,
  requireUser,
} from "@/lib/workspace/access";
import { createWorkspace } from "@/lib/workspace/timeline";
import type { WorkspaceSnapshot } from "@/lib/workspace/snapshot";

export const runtime = "nodejs";

const EMPTY: WorkspaceSnapshot = { version: 1, widgets: [] };

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const items = await listUserWorkspaces(user.id);
  return NextResponse.json({ workspaces: items });
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
    };
    const title = body.title?.trim() ?? "";
    if (!title) {
      return NextResponse.json(
        { error: "Workspace name is required" },
        { status: 400 },
      );
    }
    const created = await createWorkspace({
      title,
      ownerId: user.id,
      seedSnapshot: EMPTY,
    });
    await addWorkspaceOwner(created.workspace.id, user.id);
    return NextResponse.json(created);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Create failed" },
      { status: 400 },
    );
  }
}
