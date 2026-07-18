import { NextResponse } from "next/server";
import { z } from "zod";
import { generateWorkspaceOps, snapshotFromLiveData } from "@/lib/workspace/ai";
import { requireWorkspaceAccess } from "@/lib/workspace/access";
import { isAiConfigured } from "@/lib/llm";
import { detectLiveDataIntent } from "@/lib/workspace/data-intent";
import { resolveLiveDataForChat } from "@/lib/workspace/live-data";
import {
  addMessage,
  getLatestRevision,
  getRevisionAtSeq,
  listMessages,
  appendRevision,
} from "@/lib/workspace/timeline";
import { emptySnapshot } from "@/lib/workspace/snapshot";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  message: z.string().min(1),
  fromSeq: z.number().int().positive().optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    await requireWorkspaceAccess(body.workspaceId, "editor");

    const userMessage = await addMessage({
      workspaceId: body.workspaceId,
      role: "user",
      content: body.message,
    });

    const base =
      body.fromSeq != null
        ? await getRevisionAtSeq(body.workspaceId, body.fromSeq)
        : await getLatestRevision(body.workspaceId);

    const snapshot = base?.snapshot ?? emptySnapshot();
    const history = (await listMessages(body.workspaceId))
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    let assistantMessage: string;
    let nextSnapshot = snapshot;
    let liveMeta: { via: string; detail: string; eventCount: number } | null =
      null;

    const intent = detectLiveDataIntent(body.message);
    let liveData = null;
    if (intent) {
      try {
        liveData = await resolveLiveDataForChat({
          workspaceId: body.workspaceId,
          intent,
          userMessage: body.message,
        });
        liveMeta = {
          via: liveData.via,
          detail: liveData.detail,
          eventCount: liveData.dashboard.eventCount,
        };
      } catch (liveError) {
        console.warn("Live data pipeline failed:", liveError);
      }
    }

    const hasLiveDesk =
      liveData != null &&
      (liveData.dashboard.feed.length > 0 ||
        liveData.dashboard.metrics.length > 0 ||
        Boolean(liveData.dashboard.rich));

    // Live intents: lay out a deterministic desk from real fetched data.
    // Don't rely on the LLM to copy numbers — it often invents a GenUI instead.
    if (intent && hasLiveDesk && liveData) {
      assistantMessage = `Pulled live data via ${liveData.via} (${liveData.dashboard.eventCount} events). ${liveData.detail}`;
      nextSnapshot = snapshotFromLiveData(snapshot, liveData);
    } else if (!isAiConfigured()) {
      assistantMessage =
        "AI is not configured for the active provider. Set AI_PROVIDER=openai|gemini|vertex and the matching keys (OPENAI_*, GEMINI_API_KEY, or GOOGLE_CLOUD_PROJECT). Added a placeholder note.";
      nextSnapshot = {
        version: 1,
        widgets: [
          ...snapshot.widgets.filter((w) => w.id !== "offline-note"),
          {
            id: "offline-note",
            type: "note",
            name: "offline-note",
            title: "Offline mode",
            frame: { x: 0.08, y: 0.12, w: 0.4, h: 0.24, z: 40 },
            props: { body: body.message },
          },
        ],
      };
    } else {
      const result = await generateWorkspaceOps({
        userMessage: body.message,
        snapshot,
        history,
        liveData,
      });
      assistantMessage = result.assistantMessage;
      nextSnapshot = result.nextSnapshot;
    }

    const assistant = await addMessage({
      workspaceId: body.workspaceId,
      role: "assistant",
      content: assistantMessage,
    });

    const revision = await appendRevision({
      workspaceId: body.workspaceId,
      cause: "chat",
      snapshot: nextSnapshot,
      messageId: assistant.id,
      fromSeq: body.fromSeq ?? base?.seq ?? null,
      label: body.message.slice(0, 80),
    });

    return NextResponse.json({
      userMessage,
      assistantMessage: assistant,
      revision,
      live: liveMeta,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat failed" },
      { status: 400 },
    );
  }
}
