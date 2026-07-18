/**
 * Verifies ClickHouse Cloud connectivity and creates the app database.
 * Usage: node --env-file=.env.local scripts/init-clickhouse.mjs
 */
import { createClient } from "@clickhouse/client";

const url = process.env.CLICKHOUSE_URL;
const username = process.env.CLICKHOUSE_USER ?? "default";
const password = process.env.CLICKHOUSE_PASSWORD ?? "";
const database = process.env.CLICKHOUSE_DATABASE ?? "evodeck";

if (!url) {
  console.error(
    "Missing CLICKHOUSE_URL. Get it from https://console.clickhouse.cloud → your service → Connect.",
  );
  process.exit(1);
}

if (!password) {
  console.error("Missing CLICKHOUSE_PASSWORD.");
  process.exit(1);
}

const client = createClient({
  url,
  username,
  password,
  application: "evodeck-init",
  // Cloud services can take a while to wake from idle
  request_timeout: 60_000,
});

try {
  const ping = await client.ping({ select: true });
  if (!ping.success) {
    console.error("ClickHouse ping failed:", ping.error?.message ?? ping.error);
    process.exit(1);
  }
  console.log("✓ Connected to ClickHouse Cloud");

  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${database}`,
  });
  console.log(`✓ Database ready: ${database}`);

  const version = await client.query({
    query: "SELECT version() AS version",
    format: "JSONEachRow",
  });
  const [{ version: v }] = await version.json();
  console.log(`✓ Server version: ${v}`);
} finally {
  await client.close();
}
