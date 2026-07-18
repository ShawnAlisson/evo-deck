import { getWorkspace, listRevisions } from "@/lib/workspace/timeline";
import { HackerNewsAdapter } from "@/lib/sources/adapters";
import { insertEvents, queryEvents } from "@/lib/clickhouse/events";

async function main() {
  const id = process.env.DEFAULT_WORKSPACE_ID!;
  const ws = await getWorkspace(id);
  const revs = await listRevisions(id);
  console.log("workspace", ws?.title, "revisions", revs.length);

  const hn = new HackerNewsAdapter();
  const result = await hn.sync({ workspaceId: id });
  await insertEvents(
    result.events.slice(0, 5).map((e) => ({
      workspace_id: id,
      source: result.source,
      event_type: e.event_type,
      ts: e.ts.toISOString(),
      payload: e.payload,
    })),
  );
  const rows = await queryEvents({
    workspaceId: id,
    source: "hackernews",
    limit: 3,
  });
  console.log("clickhouse rows", rows.length, rows[0]?.event_type);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
