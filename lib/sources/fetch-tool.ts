/**
 * Allowlisted HTTP GET for agent tool-calling.
 * No SSRF: only https hosts on the allowlist, size/time limits, no redirects off-host.
 */

const ALLOWED_HOSTS = new Set([
  "api.coingecko.com",
  "api.frankfurter.app",
  "api.open-meteo.com",
  "geocoding-api.open-meteo.com",
  "api.github.com",
  "hacker-news.firebaseio.com",
  "hnrss.org",
  "en.wikipedia.org",
  "api.wikimedia.org",
  "stooq.com",
  "query1.finance.yahoo.com",
  "api.exchangerate.host",
  "open.er-api.com",
  "worldtimeapi.org",
  "api.nasa.gov",
  "api.dictionaryapi.dev",
  "restcountries.com",
  "api.zippopotam.us",
  "httpbin.org",
  "jsonplaceholder.typicode.com",
]);

const MAX_BYTES = 120_000;
const TIMEOUT_MS = 12_000;

export type FetchToolResult = {
  ok: boolean;
  url: string;
  status?: number;
  contentType?: string;
  /** Truncated JSON or text body */
  body?: unknown;
  error?: string;
  bytes?: number;
};

function isAllowedUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "Only https URLs are allowed" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Credentials in URL are not allowed" };
  }
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return {
      ok: false,
      error: `Host not allowlisted: ${host}. Allowed: ${[...ALLOWED_HOSTS].slice(0, 8).join(", ")}…`,
    };
  }
  return { ok: true, url };
}

/** Safe GET for public APIs the agent may call. */
export async function httpGetTool(input: {
  url: string;
  /** Optional Accept hint */
  accept?: string;
}): Promise<FetchToolResult> {
  const check = isAllowedUrl(input.url);
  if (!check.ok) {
    return { ok: false, url: input.url, error: check.error };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(check.url.toString(), {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: input.accept ?? "application/json, text/plain, */*",
        "User-Agent": "echoes-agent/1.0",
      },
    });

    const contentType = res.headers.get("content-type") ?? undefined;
    const buf = await res.arrayBuffer();
    const bytes = buf.byteLength;
    if (bytes > MAX_BYTES) {
      return {
        ok: false,
        url: check.url.toString(),
        status: res.status,
        contentType,
        bytes,
        error: `Response too large (${bytes} bytes; max ${MAX_BYTES})`,
      };
    }

    const text = new TextDecoder().decode(buf);
    let body: unknown = text;
    if (contentType?.includes("json") || text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 40_000);
      }
    } else {
      body = text.slice(0, 40_000);
    }

    // Cap nested JSON for the model context
    const serialized = JSON.stringify(body);
    if (serialized.length > 40_000) {
      body =
        typeof body === "string"
          ? body.slice(0, 40_000)
          : JSON.parse(serialized.slice(0, 40_000) + (serialized.startsWith("[") ? "]" : "}"));
    }

    return {
      ok: res.ok,
      url: check.url.toString(),
      status: res.status,
      contentType,
      body,
      bytes,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      url: check.url.toString(),
      error: err instanceof Error ? err.message : "Fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function listAllowedFetchHosts(): string[] {
  return [...ALLOWED_HOSTS].sort();
}
