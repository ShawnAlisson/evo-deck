import { createClient, type ClickHouseClient } from "@clickhouse/client";

let client: ClickHouseClient | null = null;

/** Shared ClickHouse Cloud client for Node.js (API routes, Server Actions, scripts). */
export function getClickHouseClient(): ClickHouseClient {
  if (client) return client;

  const url = process.env.CLICKHOUSE_URL;
  if (!url) {
    throw new Error(
      "CLICKHOUSE_URL is not set. Add it to .env.local from ClickHouse Cloud → Connect.",
    );
  }

  client = createClient({
    url,
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DATABASE ?? "default",
    application: "echoes",
  });

  return client;
}

export async function closeClickHouseClient(): Promise<void> {
  if (!client) return;
  await client.close();
  client = null;
}
