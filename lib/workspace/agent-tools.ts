import { z } from "zod";
import { chatComplete } from "@/lib/llm";
import { httpGetTool, listAllowedFetchHosts } from "@/lib/sources/fetch-tool";
import {
  lookupFx,
  lookupMarketQuote,
  resolveFxQuery,
  resolveMarketQuery,
} from "@/lib/sources/markets";
import { getSourceAdapter } from "@/lib/sources/adapters";

const toolCallSchema = z.object({
  tools: z
    .array(
      z.object({
        name: z.enum(["http_get", "lookup_price", "lookup_fx", "lookup_weather"]),
        args: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(3)
    .default([]),
  reason: z.string().optional(),
});

export type AgentToolResult = {
  name: string;
  ok: boolean;
  data: unknown;
  error?: string;
};

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Model did not return tool JSON");
  }
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<AgentToolResult> {
  try {
    if (name === "http_get") {
      const url = typeof args.url === "string" ? args.url : "";
      if (!url) return { name, ok: false, data: null, error: "url required" };
      const result = await httpGetTool({ url });
      return { name, ok: result.ok, data: result, error: result.error };
    }

    if (name === "lookup_price") {
      const query =
        typeof args.query === "string"
          ? args.query
          : typeof args.symbol === "string"
            ? args.symbol
            : "";
      if (!query) return { name, ok: false, data: null, error: "query required" };
      const quote = await lookupMarketQuote(query);
      return { name, ok: true, data: quote };
    }

    if (name === "lookup_fx") {
      const query =
        typeof args.query === "string"
          ? args.query
          : `${args.base ?? "USD"} to ${args.to ?? "EUR"}`;
      const resolved = resolveFxQuery(query) ?? {
        base: String(args.base ?? "USD"),
        quotes: [String(args.to ?? "EUR")],
      };
      const fx = await lookupFx(resolved.base, resolved.quotes);
      return { name, ok: true, data: fx };
    }

    if (name === "lookup_weather") {
      const location =
        typeof args.location === "string" ? args.location : "London";
      const adapter = getSourceAdapter("weather");
      const result = await adapter.sync({
        workspaceId: "tool",
        config: { location },
      });
      return { name, ok: true, data: result.events[0]?.payload ?? null };
    }

    return { name, ok: false, data: null, error: `Unknown tool: ${name}` };
  } catch (err) {
    return {
      name,
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : "Tool failed",
    };
  }
}

/**
 * Ask the model which allowlisted tools to run, execute them, return facts.
 * Used when intent.kind === "fetch" or as enrichment for ambiguous fact asks.
 */
export async function runAgentFetchTools(input: {
  userMessage: string;
}): Promise<{
  results: AgentToolResult[];
  detail: string;
}> {
  const hosts = listAllowedFetchHosts().join(", ");

  // Heuristic shortcuts — skip an extra LLM round-trip when obvious
  const lower = input.userMessage.toLowerCase();
  const urlMatch = input.userMessage.match(/https:\/\/[^\s"'<>]+/i);
  if (urlMatch?.[0]) {
    const result = await executeTool("http_get", { url: urlMatch[0] });
    return {
      results: [result],
      detail: `http_get ${urlMatch[0]}`,
    };
  }

  if (resolveMarketQuery(input.userMessage) && /\b(price|crypto|stock|btc|eth)\b/.test(lower)) {
    const result = await executeTool("lookup_price", {
      query: input.userMessage,
    });
    return { results: [result], detail: "lookup_price (heuristic)" };
  }

  if (resolveFxQuery(input.userMessage)) {
    const result = await executeTool("lookup_fx", { query: input.userMessage });
    return { results: [result], detail: "lookup_fx (heuristic)" };
  }

  const raw = await chatComplete({
    temperature: 0,
    json: true,
    messages: [
      {
        role: "system",
        content: `You choose tools to fetch REAL live data. Return ONLY JSON:
{"tools":[{"name":"http_get"|"lookup_price"|"lookup_fx"|"lookup_weather","args":{...}}],"reason":"..."}

Tools:
- http_get: {"url":"https://..."} — ONLY these hosts: ${hosts}
- lookup_price: {"query":"bitcoin"|"AAPL"|...}
- lookup_fx: {"query":"USD to EUR"} or {"base":"USD","to":"EUR"}
- lookup_weather: {"location":"Paris"}

Rules:
- Prefer specialized tools over raw http_get when they fit.
- Max 2 tools. If nothing useful, return {"tools":[]}.
- Never invent URLs outside the allowlist.
- For CoinGecko use https://api.coingecko.com/api/v3/...
- For Frankfurter use https://api.frankfurter.app/...
- For Open-Meteo use https://api.open-meteo.com/...`,
      },
      { role: "user", content: input.userMessage },
    ],
  });

  const parsed = toolCallSchema.parse(extractJsonObject(raw));
  if (parsed.tools.length === 0) {
    return { results: [], detail: "No tools selected" };
  }

  const results: AgentToolResult[] = [];
  for (const t of parsed.tools.slice(0, 2)) {
    results.push(await executeTool(t.name, t.args));
  }

  return {
    results,
    detail: `Tools: ${results.map((r) => `${r.name}${r.ok ? "" : "(fail)"}`).join(", ")}`,
  };
}

/** Turn tool results into a compact live-data-like dashboard for the canvas agent. */
export function dashboardFromToolResults(results: AgentToolResult[]) {
  const feed = results.map((r) => ({
    title: r.ok
      ? `${r.name}: ${summarizeToolData(r.data)}`
      : `${r.name} failed: ${r.error}`,
    meta: r.ok ? "live fetch" : "error",
    source: "fetch",
  }));

  const metrics: Array<{
    id: string;
    title: string;
    value: string;
    unit?: string;
  }> = [];

  for (const r of results) {
    if (!r.ok || !r.data || typeof r.data !== "object") continue;
    const d = r.data as Record<string, unknown>;
    if (typeof d.price === "number") {
      metrics.push({
        id: "tool-price",
        title: String(d.name ?? d.symbol ?? "Price"),
        value: String(d.price),
        unit: typeof d.currency === "string" ? d.currency : "USD",
      });
    }
    if (typeof d.temperature === "number") {
      metrics.push({
        id: "tool-temp",
        title: String(d.location ?? "Weather"),
        value: String(d.temperature),
        unit: typeof d.temperatureUnit === "string" ? d.temperatureUnit : "°C",
      });
    }
    if (d.rates && typeof d.rates === "object") {
      const rates = d.rates as Record<string, number>;
      const first = Object.entries(rates)[0];
      if (first) {
        metrics.push({
          id: "tool-fx",
          title: `1 ${d.base ?? ""} → ${first[0]}`,
          value: String(first[1]),
        });
      }
    }
  }

  let chart:
    | { id: string; title: string; series: number[]; labels: string[] }
    | undefined;
  for (const r of results) {
    if (!r.ok || !r.data || typeof r.data !== "object") continue;
    const d = r.data as Record<string, unknown>;
    const spark = d.sparkline as
      | { labels?: string[]; values?: number[] }
      | undefined;
    if (spark?.values && spark.values.length >= 2) {
      chart = {
        id: "tool-spark",
        title: `${d.symbol ?? d.name ?? "Price"} trend`,
        series: spark.values,
        labels: spark.labels ?? spark.values.map((_, i) => `D${i + 1}`),
      };
      break;
    }
    if (
      Array.isArray(d.sparklineValues) &&
      (d.sparklineValues as number[]).length >= 2
    ) {
      chart = {
        id: "tool-spark",
        title: `${d.symbol ?? "Price"} trend`,
        series: d.sparklineValues as number[],
        labels: (d.sparklineLabels as string[]) ??
          (d.sparklineValues as number[]).map((_, i) => `D${i + 1}`),
      };
      break;
    }
  }

  return {
    sources: ["fetch"],
    feed,
    metrics,
    chart,
    eventCount: results.length,
    toolResults: results,
  };
}

function summarizeToolData(data: unknown): string {
  if (data == null) return "(empty)";
  if (typeof data === "string") return data.slice(0, 120);
  if (typeof data !== "object") return String(data).slice(0, 120);
  const d = data as Record<string, unknown>;
  if (typeof d.price === "number") {
    return `${d.name ?? d.symbol}: ${d.price} ${d.currency ?? ""}`.trim();
  }
  if (typeof d.temperature === "number") {
    return `${d.location}: ${d.temperature}${d.temperatureUnit ?? "°C"}, ${d.condition ?? ""}`;
  }
  if (d.rates && typeof d.rates === "object") {
    return `${d.base} rates: ${JSON.stringify(d.rates).slice(0, 80)}`;
  }
  if (typeof d.body !== "undefined") {
    return `HTTP ${d.status ?? ""} ${String(d.url ?? "").slice(0, 60)}`;
  }
  return JSON.stringify(data).slice(0, 120);
}
