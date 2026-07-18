import { NextResponse } from "next/server";
import { requireWorkspaceAccess } from "@/lib/workspace/access";
import {
  leavePresence,
  listPresence,
  touchPresence,
} from "@/lib/workspace/presence";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, "viewer");
    return NextResponse.json({ presence: listPresence(id) });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const { user } = await requireWorkspaceAccess(id, "viewer");
    const body = (await request.json().catch(() => ({}))) as {
      leave?: boolean;
    };
    if (body.leave) {
      leavePresence(id, user.id);
      return NextResponse.json({ presence: listPresence(id) });
    }
    const presence = touchPresence(id, {
      id: user.id,
      name: user.name,
      email: user.email,
    });
    return NextResponse.json({ presence });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}
