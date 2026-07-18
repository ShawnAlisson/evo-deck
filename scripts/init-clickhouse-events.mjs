/**
 * Creates ClickHouse analytics tables for EvoDeck.
 * Usage: node --env-file=.env.local scripts/init-clickhouse-events.mjs
 */
import { createClient } from "@clickhouse/client";

const url = process.env.CLICKHOUSE_URL;
const username = process.env.CLICKHOUSE_USER ?? "default";
const password = process.env.CLICKHOUSE_PASSWORD ?? "";
const database = process.env.CLICKHOUSE_DATABASE ?? "evodeck";

if (!url || !password) {
  console.error("Missing CLICKHOUSE_URL or CLICKHOUSE_PASSWORD");
  process.exit(1);
}

const client = createClient({
  url,
  username,
  password,
  application: "evodeck-events-init",
  request_timeout: 60_000,
});

try {
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS \`${database}\``,
  });

  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS \`${database}\`.events
      (
        workspace_id String,
        source LowCardinality(String),
        event_type LowCardinality(String),
        ts DateTime64(3, 'UTC'),
        payload String,
        ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
      )
      ENGINE = MergeTree
      PARTITION BY toYYYYMM(ts)
      ORDER BY (workspace_id, source, ts, event_type)
    `,
  });

  console.log(`✓ ${database}.events ready`);
} finally {
  await client.close();
}
