import { getClickHouseClient } from "@/lib/clickhouse";

export type EvoDeckEvent = {
  workspace_id: string;
  source: string;
  event_type: string;
  ts: string; // ISO
  payload: Record<string, unknown>;
};

export async function insertEvents(events: EvoDeckEvent[]) {
  if (events.length === 0) return;
  const client = getClickHouseClient();
  await client.insert({
    table: "events",
    values: events.map((e) => ({
      workspace_id: e.workspace_id,
      source: e.source,
      event_type: e.event_type,
      ts: e.ts.replace("T", " ").replace("Z", ""),
      payload: JSON.stringify(e.payload),
    })),
    format: "JSONEachRow",
  });
}

export async function queryEvents(input: {
  workspaceId: string;
  source?: string;
  limit?: number;
}) {
  const client = getClickHouseClient();
  const result = await client.query({
    query: `
      SELECT
        workspace_id,
        source,
        event_type,
        ts,
        payload
      FROM events
      WHERE workspace_id = {workspaceId:String}
        AND ({source:String} = '' OR source = {source:String})
      ORDER BY ts DESC
      LIMIT {limit:UInt32}
    `,
    query_params: {
      workspaceId: input.workspaceId,
      source: input.source ?? "",
      limit: input.limit ?? 50,
    },
    format: "JSONEachRow",
  });

  return result.json<{
    workspace_id: string;
    source: string;
    event_type: string;
    ts: string;
    payload: unknown;
  }>();
}
