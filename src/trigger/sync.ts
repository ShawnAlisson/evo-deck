import { schedules, task, logger } from "@trigger.dev/sdk";
import { getSourceAdapter } from "@/lib/sources/adapters";
import { insertEvents } from "@/lib/clickhouse/events";

export const syncSourceTask = task({
  id: "sync-source",
  maxDuration: 300,
  run: async (payload: {
    workspaceId: string;
    source: string;
    config?: Record<string, unknown>;
  }) => {
    const adapter = getSourceAdapter(payload.source);
    const result = await adapter.sync({
      workspaceId: payload.workspaceId,
      config: payload.config,
    });

    await insertEvents(
      result.events.map((e) => ({
        workspace_id: payload.workspaceId,
        source: result.source,
        event_type: e.event_type,
        ts: e.ts.toISOString(),
        payload: e.payload,
      })),
    );

    logger.log("Synced source", {
      source: result.source,
      count: result.events.length,
      workspaceId: payload.workspaceId,
    });

    return { count: result.events.length, source: result.source };
  },
});

export const researchWorkspaceTask = task({
  id: "research-workspace",
  maxDuration: 600,
  run: async (payload: {
    workspaceId: string;
    topic: string;
  }) => {
    logger.log("Starting research workflow", payload);

    // Stage 1: pull HN
    await syncSourceTask.triggerAndWait({
      workspaceId: payload.workspaceId,
      source: "hackernews",
    });

    // Stage 2: pull RSS related signal
    await syncSourceTask.triggerAndWait({
      workspaceId: payload.workspaceId,
      source: "rss",
      config: { url: "https://hnrss.org/frontpage" },
    });

    logger.log("Research stages complete", { topic: payload.topic });
    return { ok: true, topic: payload.topic };
  },
});

export const syncHackerNewsSchedule = schedules.task({
  id: "sync-hackernews-schedule",
  cron: "*/30 * * * *",
  run: async () => {
    const workspaceId = process.env.DEFAULT_WORKSPACE_ID;
    if (!workspaceId) {
      logger.warn("DEFAULT_WORKSPACE_ID not set; skipping HN schedule");
      return { skipped: true };
    }

    return syncSourceTask.triggerAndWait({
      workspaceId,
      source: "hackernews",
    });
  },
});
