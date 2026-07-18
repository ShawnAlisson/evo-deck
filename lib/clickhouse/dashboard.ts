import { queryEvents, type EvoDeckEvent } from "@/lib/clickhouse/events";
import {
  buildDashboardFromEvents,
  type LiveDashboardData,
  type LiveFeedItem,
} from "@/lib/clickhouse/build-dashboard";

export type { LiveDashboardData, LiveFeedItem };

export async function aggregateLiveDashboard(input: {
  workspaceId: string;
  sources?: string[];
  limit?: number;
}): Promise<LiveDashboardData> {
  const sources = input.sources ?? [];
  const rows = await queryEvents({
    workspaceId: input.workspaceId,
    limit: input.limit ?? 40,
  });

  const dash = buildDashboardFromEvents(rows, sources);
  return dash;
}

export type { EvoDeckEvent };
