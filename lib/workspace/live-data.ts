import { getSourceAdapter } from "@/lib/sources/adapters";
import { insertEvents } from "@/lib/clickhouse/events";
import {
  aggregateLiveDashboard,
  type LiveDashboardData,
} from "@/lib/clickhouse/dashboard";
import { buildDashboardFromEvents } from "@/lib/clickhouse/build-dashboard";
import type { LiveDataIntent } from "@/lib/workspace/data-intent";

export type LiveDataBundle = {
  intent: LiveDataIntent;
  dashboard: LiveDashboardData;
  via: "trigger" | "inline" | "memory";
  detail: string;
};

type MemEvent = {
  workspace_id: string;
  source: string;
  event_type: string;
  ts: string;
  payload: Record<string, unknown>;
};

async function syncToMemory(
  workspaceId: string,
  source: string,
  config?: Record<string, unknown>,
): Promise<MemEvent[]> {
  const adapter = getSourceAdapter(source);
  const result = await adapter.sync({ workspaceId, config });
  return result.events.map((e) => ({
    workspace_id: workspaceId,
    source: result.source,
    event_type: e.event_type,
    ts: e.ts.toISOString(),
    payload: e.payload,
  }));
}

async function syncInline(
  workspaceId: string,
  source: string,
  config?: Record<string, unknown>,
) {
  const events = await syncToMemory(workspaceId, source, config);
  try {
    await insertEvents(events);
  } catch (err) {
    console.warn("ClickHouse insert failed; keeping in-memory events:", err);
    return { count: events.length, events, persisted: false as const };
  }
  return { count: events.length, events, persisted: true as const };
}

async function runViaTrigger(intent: LiveDataIntent, workspaceId: string) {
  const { syncSourceTask, researchWorkspaceTask } = await import(
    "@/src/trigger/sync"
  );

  if (intent.kind === "research") {
    await researchWorkspaceTask.trigger({
      workspaceId,
      topic: intent.topic,
    });
    return `Queued Trigger research-workspace for “${intent.topic}”`;
  }

  await syncSourceTask.trigger({
    workspaceId,
    source: intent.source,
    config: intent.config,
  });
  return `Queued Trigger sync-source (${intent.source})`;
}

async function runInline(intent: LiveDataIntent, workspaceId: string) {
  if (intent.kind === "research") {
    const hn = await syncInline(workspaceId, "hackernews");
    const rss = await syncInline(workspaceId, "rss", {
      url: "https://hnrss.org/frontpage",
    });
    const events = [...hn.events, ...rss.events];
    const persisted = hn.persisted && rss.persisted;
    return {
      detail: `Inline research sync (HN ${hn.count}, RSS ${rss.count})${persisted ? "" : " · memory fallback"}`,
      events,
      persisted,
    };
  }
  const one = await syncInline(workspaceId, intent.source, intent.config);
  return {
    detail: `Inline sync ${intent.source} (${one.count} events)${one.persisted ? "" : " · memory fallback"}`,
    events: one.events,
    persisted: one.persisted,
  };
}

/**
 * Orchestrate live data for a chat turn:
 * 1) Fetch adapters inline (always)
 * 2) Persist to ClickHouse when available
 * 3) Build dashboard from CH or in-memory events
 */
export async function resolveLiveDataForChat(input: {
  workspaceId: string;
  intent: LiveDataIntent;
}): Promise<LiveDataBundle> {
  let via: LiveDataBundle["via"] = "inline";
  let detail = "";
  let memoryEvents: MemEvent[] = [];

  try {
    const inline = await runInline(input.intent, input.workspaceId);
    detail = inline.detail;
    memoryEvents = inline.events;
    via = inline.persisted ? "inline" : "memory";
  } catch (inlineError) {
    console.warn("Inline live sync failed, trying Trigger queue:", inlineError);
    via = "trigger";
    detail = await runViaTrigger(input.intent, input.workspaceId);
  }

  const sources =
    input.intent.kind === "research"
      ? input.intent.sources
      : [input.intent.source];

  let dashboard: LiveDashboardData;
  try {
    dashboard = await aggregateLiveDashboard({
      workspaceId: input.workspaceId,
      sources,
      limit: 50,
    });
    if (dashboard.feed.length === 0 && memoryEvents.length > 0) {
      dashboard = buildDashboardFromEvents(memoryEvents, sources);
      via = via === "trigger" ? via : "memory";
    }
  } catch (err) {
    console.warn("ClickHouse aggregate failed; using memory dashboard:", err);
    dashboard = buildDashboardFromEvents(memoryEvents, sources);
    via = "memory";
    detail = `${detail} · dashboard from memory`;
  }

  return {
    intent: input.intent,
    dashboard,
    via,
    detail,
  };
}
