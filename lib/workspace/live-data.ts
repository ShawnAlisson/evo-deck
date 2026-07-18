import { getSourceAdapter } from "@/lib/sources/adapters";
import { insertEvents } from "@/lib/clickhouse/events";
import {
  aggregateLiveDashboard,
  type LiveDashboardData,
} from "@/lib/clickhouse/dashboard";
import { buildDashboardFromEvents } from "@/lib/clickhouse/build-dashboard";
import type { LiveDataIntent } from "@/lib/workspace/data-intent";
import {
  dashboardFromToolResults,
  runAgentFetchTools,
} from "@/lib/workspace/agent-tools";

export type LiveDataBundle = {
  intent: LiveDataIntent;
  dashboard: LiveDashboardData;
  via: "trigger" | "inline" | "memory" | "tools";
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

type SyncOrResearchIntent = Exclude<LiveDataIntent, { kind: "fetch" }>;

async function runViaTrigger(intent: SyncOrResearchIntent, workspaceId: string) {
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

async function runInline(intent: SyncOrResearchIntent, workspaceId: string) {
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

async function runFetchIntent(userMessage: string): Promise<LiveDataBundle> {
  const { results, detail } = await runAgentFetchTools({ userMessage });
  const toolDash = dashboardFromToolResults(results);

  // Promote successful price/weather/fx tool payloads into rich desks
  const rich: LiveDashboardData["rich"] = {};
  for (const r of results) {
    if (!r.ok || !r.data || typeof r.data !== "object") continue;
    const d = r.data as Record<string, unknown>;
    if (r.name === "lookup_weather" || typeof d.temperature === "number") {
      rich.weather = d;
    }
    if (r.name === "lookup_price" || typeof d.price === "number") {
      rich.markets = {
        ...d,
        sparklineLabels: (d.sparkline as { labels?: string[] } | undefined)?.labels,
        sparklineValues: (d.sparkline as { values?: number[] } | undefined)?.values,
      };
    }
    if (r.name === "lookup_fx" || d.rates) {
      const rates = (d.rates as Record<string, number>) ?? {};
      rich.fx = {
        ...d,
        rateLabels: Object.keys(rates),
        rateValues: Object.values(rates),
      };
    }
  }

  return {
    intent: { kind: "fetch", topic: userMessage.slice(0, 200) },
    dashboard: {
      sources: toolDash.sources,
      feed: toolDash.feed,
      metrics: toolDash.metrics,
      chart: toolDash.chart,
      rich: Object.keys(rich).length ? rich : undefined,
      eventCount: toolDash.eventCount,
    },
    via: "tools",
    detail,
  };
}

/**
 * Orchestrate live data for a chat turn:
 * 1) Fetch adapters inline (always) — or agent http_get tools for fetch intents
 * 2) Persist to ClickHouse when available
 * 3) Build dashboard from CH or in-memory events
 */
export async function resolveLiveDataForChat(input: {
  workspaceId: string;
  intent: LiveDataIntent;
  userMessage?: string;
}): Promise<LiveDataBundle> {
  if (input.intent.kind === "fetch") {
    return runFetchIntent(input.userMessage ?? input.intent.topic);
  }

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
  // Prefer freshly synced in-memory events for this turn (avoids stale CH rows)
  if (memoryEvents.length > 0) {
    dashboard = buildDashboardFromEvents(memoryEvents, sources);
  } else {
    try {
      dashboard = await aggregateLiveDashboard({
        workspaceId: input.workspaceId,
        sources,
        limit: 50,
      });
    } catch (err) {
      console.warn("ClickHouse aggregate failed; empty dashboard:", err);
      dashboard = buildDashboardFromEvents([], sources);
      via = "memory";
      detail = `${detail} · dashboard empty`;
    }
  }

  return {
    intent: input.intent,
    dashboard,
    via,
    detail,
  };
}
