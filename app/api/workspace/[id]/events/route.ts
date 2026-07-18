import { requireWorkspaceAccess } from "@/lib/workspace/access";
import { listRevisions } from "@/lib/workspace/timeline";
import {
  listPresence,
  touchPresence,
} from "@/lib/workspace/presence";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** SSE: revision changes + collaborator presence for live collab. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;

  let user;
  try {
    ({ user } = await requireWorkspaceAccess(id, "viewer"));
  } catch (error) {
    if (error instanceof Response) return error;
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };

      touchPresence(id, {
        id: user.id,
        name: user.name,
        email: user.email,
      });
      send({ type: "hello", workspaceId: id, userId: user.id });
      send({ type: "presence", presence: listPresence(id) });

      let lastCount = -1;
      const tick = async () => {
        if (closed) return;
        try {
          touchPresence(id, {
            id: user.id,
            name: user.name,
            email: user.email,
          });
          const revisions = await listRevisions(id);
          if (revisions.length !== lastCount) {
            lastCount = revisions.length;
            send({
              type: "revisions",
              count: revisions.length,
              headSeq: revisions[revisions.length - 1]?.seq ?? 0,
            });
          }
          send({ type: "presence", presence: listPresence(id) });
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : "poll failed",
          });
        }
      };

      await tick();
      const interval = setInterval(tick, 2000);

      const abort = () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      request.signal.addEventListener("abort", abort);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
