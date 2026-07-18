export type LiveSource =
  | "hackernews"
  | "rss"
  | "github"
  | "weather"
  | "markets"
  | "fx"
  | "wikipedia";

export type LiveDataIntent =
  | {
      kind: "research";
      topic: string;
      sources: Array<"hackernews" | "rss">;
    }
  | {
      kind: "sync";
      source: LiveSource;
      config?: Record<string, unknown>;
      topic?: string;
    }
  | {
      /** Model-driven allowlisted HTTP GET(s) */
      kind: "fetch";
      topic: string;
    };

function extractWeatherLocation(text: string, lower: string): string {
  const patterns = [
    /\b(?:weather|forecast|temperature|temps?)\s+(?:like\s+)?(?:in|for|at)\s+([a-z0-9\s\-']{2,48})/i,
    /\b(?:in|for|at)\s+([a-z][a-z0-9\s\-']{1,40}?)(?:\s+(?:today|tonight|tomorrow|now|right now|this week|please)|\?|$)/i,
    /\bhow(?:'s|s| is)?\s+(?:the\s+)?weather\s+(?:like\s+)?(?:in|for|at)\s+([a-z0-9\s\-']{2,40})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re) ?? lower.match(re);
    if (m?.[1]) {
      return m[1]
        .replace(/\?+$/, "")
        .replace(/\b(today|tonight|tomorrow|now|please|right now)\b/gi, "")
        .trim();
    }
  }
  return "London";
}

/**
 * Detect prompts that need live external data (adapters → optional ClickHouse),
 * vs pure canvas/Q&A generation.
 */
export function detectLiveDataIntent(message: string): LiveDataIntent | null {
  const text = message.trim();
  const lower = text.toLowerCase();

  if (
    /\b(research|briefing|signal desk|news desk|what.?s (hot|trending|happening)|live signals?)\b/.test(
      lower,
    )
  ) {
    return {
      kind: "research",
      topic: text.slice(0, 160),
      sources: ["hackernews", "rss"],
    };
  }

  if (/\b(hacker\s*news|\bhn\b|frontpage|top stor)/.test(lower)) {
    return { kind: "sync", source: "hackernews", topic: text.slice(0, 160) };
  }

  if (/\b(weather|forecast|temperature|how hot|how cold|temps?\b)\b/.test(lower)) {
    return {
      kind: "sync",
      source: "weather",
      config: { location: extractWeatherLocation(text, lower) },
      topic: text.slice(0, 160),
    };
  }

  // FX before markets so "USD to EUR" doesn't become a crypto query.
  // Require separators around "to" so "new todos" / "add todos" don't match as NEW→DOS.
  if (
    /\b(exchange rate|forex|\bfx\b|currency convert|convert\s+\d|usd\s+to\s+|eur\s+to\s+|gbp\s+to\s+)/.test(
      lower,
    ) ||
    /\b[a-z]{3}\s*(?:\/|->)\s*[a-z]{3}\b/.test(lower) ||
    /\b[a-z]{3}\s+to\s+[a-z]{3}\b/.test(lower)
  ) {
    return {
      kind: "sync",
      source: "fx",
      config: { query: text.slice(0, 120) },
      topic: text.slice(0, 160),
    };
  }

  if (
    /\b(price|prices|stock|stocks|ticker|crypto|bitcoin|\bbtc\b|ethereum|\beth\b|coin|market cap|how much (is|are)|trading at|quote for)\b/.test(
      lower,
    )
  ) {
    return {
      kind: "sync",
      source: "markets",
      config: { query: text.slice(0, 120) },
      topic: text.slice(0, 160),
    };
  }

  const ghUser = lower.match(
    /\bgithub(?:\s+activity|\s+events?)?(?:\s+for|\s+of|\s+@)?\s+([a-z0-9-]+)/i,
  );
  if (
    ghUser?.[1] &&
    !["activity", "events", "feed", "repos"].includes(ghUser[1])
  ) {
    return {
      kind: "sync",
      source: "github",
      config: { user: ghUser[1] },
      topic: text.slice(0, 160),
    };
  }
  if (/\bgithub\b/.test(lower)) {
    return {
      kind: "sync",
      source: "github",
      config: { user: "vercel" },
      topic: text.slice(0, 160),
    };
  }

  if (
    /\brss\b|\bfeed\b/.test(lower) &&
    /\b(pull|sync|show|load|fetch)\b/.test(lower)
  ) {
    return { kind: "sync", source: "rss", topic: text.slice(0, 160) };
  }

  if (
    /\b(war.?room|ops board|situation room|shared desk|collab(?:orative)? desk)\b/.test(
      lower,
    )
  ) {
    return {
      kind: "research",
      topic: text.slice(0, 160),
      sources: ["hackernews", "rss"],
    };
  }

  // Explicit fetch / curl / look up on the web
  if (
    /\b(fetch|curl|http\s*get|look\s*up|lookup|search the web|from the (web|internet|api))\b/.test(
      lower,
    )
  ) {
    return { kind: "fetch", topic: text.slice(0, 200) };
  }

  // Soft fact lookup → wikipedia when asking "what is X"
  if (
    /\b(who is|what is|what'?s|tell me about|wiki(?:pedia)?)\b/.test(lower) &&
    lower.length < 120
  ) {
    const topic =
      text
        .replace(
          /^(who is|what is|what'?s|tell me about|wiki(?:pedia)?\s*(on|about)?)\s+/i,
          "",
        )
        .replace(/\?+$/, "")
        .trim() || text.slice(0, 80);
    return {
      kind: "sync",
      source: "wikipedia",
      config: { topic },
      topic: text.slice(0, 160),
    };
  }

  return null;
}

/** Client busy-label helper — keep in sync with detectLiveDataIntent keywords. */
export function isLiveDataBusyMessage(message: string): boolean {
  return detectLiveDataIntent(message) != null;
}
