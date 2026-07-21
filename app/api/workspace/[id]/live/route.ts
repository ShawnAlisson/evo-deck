import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/workspace/access";
import { detectLiveDataIntent } from "@/lib/workspace/data-intent";
import { resolveLiveDataForChat } from "@/lib/workspace/live-data";
import { snapshotFromLiveData } from "@/lib/workspace/live-desk";
import { listSourceAdapters } from "@/lib/sources/adapters";
import { listAllowedFetchHosts } from "@/lib/sources/fetch-tool";
import {
  getLatestRevision,
  appendRevision,
  addMessage,
} from "@/lib/workspace/timeline";
import { emptySnapshot } from "@/lib/workspace/snapshot";
import { aggregateLiveDashboard } from "@/lib/clickhouse/dashboard";

export const runtime = "nodejs";
export const maxDuration = 120;

const postSchema = z.object({
  /** Free-text prompt, e.g. "weather in Tokyo" or "BTC price" */
  message: z.string().min(1).optional(),
  /** Explicit adapter sync */
  source: z
    .enum([
      "hackernews",
      "rss",
      "github",
      "weather",
      "markets",
      "fx",
      "wikipedia",
    ])
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  /** When true, also write a canvas revision with the live desk */
  applyToCanvas: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

/** GET — current live desk status + available sources */
export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { id: workspaceId } = await ctx.params;
    await requireWorkspaceAccess(workspaceId, "viewer");

    let dashboard = null;
    try {
      dashboard = await aggregateLiveDashboard({
        workspaceId,
        limit: 40,
      });
    } catch (err) {
      console.warn("Live GET dashboard failed:", err);
    }

    return NextResponse.json({
      workspaceId,
      adapters: listSourceAdapters(),
      fetchHosts: listAllowedFetchHosts(),
      dashboard,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Live status failed" },
      { status: 400 },
    );
  }
}

/** POST — refresh live data (and optionally apply desk to canvas) */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const { id: workspaceId } = await ctx.params;
    await requireWorkspaceAccess(workspaceId, "editor");
    const body = postSchema.parse(await request.json());

    const message =
      body.message ??
      (body.source ? `sync ${body.source}` : "refresh live desk");

    let intent = detectLiveDataIntent(message);
    if (!intent && body.source) {
      intent = {
        kind: "sync",
        source: body.source,
        config: body.config,
        topic: message.slice(0, 160),
      };
    }
    if (!intent) {
      return NextResponse.json(
        {
          error:
            "Could not detect a live-data intent. Try: weather in Paris, BTC price, USD to EUR, HN, or fetch <url>",
        },
        { status: 400 },
      );
    }

    const live = await resolveLiveDataForChat({
      workspaceId,
      intent,
      userMessage: message,
    });

    let revision = null;
    if (body.applyToCanvas) {
      const base = await getLatestRevision(workspaceId);
      const snapshot = base?.snapshot ?? emptySnapshot();
      const next = snapshotFromLiveData(snapshot, live);
      const assistant = await addMessage({
        workspaceId,
        role: "assistant",
        content: `Live desk refresh via ${live.via}: ${live.detail}`,
      });
      revision = await appendRevision({
        workspaceId,
        cause: "chat",
        snapshot: next,
        messageId: assistant.id,
        label: `Live: ${message.slice(0, 60)}`,
      });
    }

    return NextResponse.json({
      live: {
        via: live.via,
        detail: live.detail,
        eventCount: live.dashboard.eventCount,
        sources: live.dashboard.sources,
      },
      dashboard: live.dashboard,
      revision,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Live refresh failed" },
      { status: 400 },
    );
  }
}
