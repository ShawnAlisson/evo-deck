import { NextResponse } from "next/server";
import { z } from "zod";
import { tasks } from "@trigger.dev/sdk";
import type { syncSourceTask, researchWorkspaceTask } from "@/src/trigger/sync";
import { requireWorkspaceAccess } from "@/lib/workspace/access";

export const runtime = "nodejs";

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  source: z.enum(["hackernews", "rss", "github", "weather"]).default("hackernews"),
  config: z.record(z.string(), z.unknown()).optional(),
  mode: z.enum(["sync", "research"]).default("sync"),
  topic: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    await requireWorkspaceAccess(body.workspaceId, "editor");

    if (body.mode === "research") {
      const handle = await tasks.trigger<typeof researchWorkspaceTask>(
        "research-workspace",
        {
          workspaceId: body.workspaceId,
          topic: body.topic ?? "general",
        },
      );
      return NextResponse.json({ handle, mode: "research" });
    }

    const handle = await tasks.trigger<typeof syncSourceTask>("sync-source", {
      workspaceId: body.workspaceId,
      source: body.source,
      config: body.config,
    });

    return NextResponse.json({ handle, mode: "sync" });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 400 },
    );
  }
}
