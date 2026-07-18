import { NextResponse } from "next/server";
import { z } from "zod";
import { queryEvents } from "@/lib/clickhouse/events";

export const runtime = "nodejs";

const querySchema = z.object({
  workspaceId: z.string().uuid(),
  source: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.parse({
      workspaceId: searchParams.get("workspaceId"),
      source: searchParams.get("source") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    const rows = await queryEvents(parsed);
    return NextResponse.json({
      items: rows.map((row) => {
        const payload =
          typeof row.payload === "string"
            ? JSON.parse(row.payload)
            : row.payload;
        return {
          title:
            (payload as { title?: string })?.title ??
            `${row.source}:${row.event_type}`,
          meta: row.ts,
          url: (payload as { url?: string })?.url,
          source: row.source,
          eventType: row.event_type,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Query failed" },
      { status: 400 },
    );
  }
}
