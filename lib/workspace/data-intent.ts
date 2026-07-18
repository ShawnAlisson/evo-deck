export type LiveSource = "hackernews" | "rss" | "github" | "weather";

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
    };

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

  if (/\b(weather|forecast|temperature|how hot|how cold)\b/.test(lower)) {
    const loc =
      lower.match(
        /\b(?:weather|forecast|temperature)\s+(?:in|for|at)\s+([a-z0-9\s\-']{2,40})/i,
      )?.[1] ??
      lower.match(/\bin\s+([a-z][a-z\s\-']{1,40})$/i)?.[1] ??
      "London";
    return {
      kind: "sync",
      source: "weather",
      config: { location: loc.replace(/\?+$/, "").trim() },
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

  return null;
}
