export type LiveFeedItem = {
  title: string;
  meta?: string;
  url?: string;
  source: string;
  score?: number;
};

export type LiveDashboardData = {
  sources: string[];
  feed: LiveFeedItem[];
  metrics: Array<{ id: string; title: string; value: string; unit?: string }>;
  chart?: {
    id: string;
    title: string;
    series: number[];
    labels: string[];
  };
  eventCount: number;
};

type EventRow = {
  source: string;
  event_type: string;
  ts: string;
  payload: unknown;
};

function parsePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }
  return {};
}

/** Build a live desk dashboard from event rows (ClickHouse or in-memory). */
export function buildDashboardFromEvents(
  rows: EventRow[],
  sources: string[] = [],
): LiveDashboardData {
  const filtered =
    sources.length === 0
      ? rows
      : rows.filter((r) => sources.includes(r.source));

  const feed: LiveFeedItem[] = filtered.slice(0, 12).map((row) => {
    const payload = parsePayload(row.payload);
    const title =
      typeof payload.title === "string"
        ? payload.title
        : typeof payload.repo === "string"
          ? `${payload.type ?? row.event_type}: ${payload.repo}`
          : typeof payload.summary === "string"
            ? payload.summary
            : `${row.source}:${row.event_type}`;
    const score =
      typeof payload.score === "number" ? payload.score : undefined;
    return {
      title,
      meta: [
        row.source,
        score != null ? `${score} pts` : null,
        typeof payload.by === "string" ? payload.by : null,
        typeof payload.location === "string" ? payload.location : null,
        row.ts,
      ]
        .filter(Boolean)
        .join(" · "),
      url: typeof payload.url === "string" ? payload.url : undefined,
      source: row.source,
      score,
    };
  });

  const metrics: LiveDashboardData["metrics"] = [];

  const weather = filtered.find((r) => r.source === "weather");
  if (weather) {
    const p = parsePayload(weather.payload);
    const temp = p.temperature;
    const unit = typeof p.temperatureUnit === "string" ? p.temperatureUnit : "°C";
    const humidity = p.humidity;
    const wind = p.windSpeed;
    const location =
      typeof p.location === "string" ? p.location : "Weather";
    if (temp != null) {
      metrics.push({
        id: "metric-temp",
        title: location,
        value: String(temp),
        unit,
      });
    }
    if (humidity != null) {
      metrics.push({
        id: "metric-humidity",
        title: "Humidity",
        value: String(humidity),
        unit: "%",
      });
    }
    if (wind != null) {
      metrics.push({
        id: "metric-wind",
        title: "Wind",
        value: String(wind),
        unit: typeof p.windUnit === "string" ? p.windUnit : "km/h",
      });
    }
  }

  metrics.push({
    id: "metric-events",
    title: "Live events",
    value: String(filtered.length),
  });

  const hnScores = filtered
    .filter((r) => r.source === "hackernews")
    .map((r) => {
      const p = parsePayload(r.payload);
      return typeof p.score === "number" ? p.score : 0;
    })
    .filter((n) => n > 0);

  if (hnScores.length > 0) {
    const avg = Math.round(
      hnScores.reduce((a, b) => a + b, 0) / hnScores.length,
    );
    const top = Math.max(...hnScores);
    metrics.push(
      { id: "metric-avg-score", title: "Avg HN score", value: String(avg) },
      { id: "metric-top-score", title: "Top score", value: String(top) },
    );
  }

  const githubRows = filtered.filter((r) => r.source === "github");
  if (githubRows.length > 0) {
    metrics.push({
      id: "metric-gh",
      title: "GitHub events",
      value: String(githubRows.length),
    });
  }

  let chart: LiveDashboardData["chart"];
  if (hnScores.length >= 3) {
    const buckets = [0, 50, 100, 200, 400, 800];
    const labels = ["0-49", "50-99", "100-199", "200-399", "400-799", "800+"];
    const series = labels.map(() => 0);
    for (const score of hnScores) {
      let idx = buckets.length - 1;
      for (let i = 0; i < buckets.length - 1; i++) {
        if (score < buckets[i + 1]!) {
          idx = i;
          break;
        }
      }
      series[idx] = (series[idx] ?? 0) + 1;
    }
    chart = {
      id: "chart-hn-scores",
      title: "HN score distribution",
      series,
      labels,
    };
  } else if (githubRows.length >= 3) {
    const counts = new Map<string, number>();
    for (const row of githubRows) {
      const key = row.event_type.replace(/Event$/, "") || row.event_type;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const entries = [...counts.entries()].slice(0, 8);
    chart = {
      id: "chart-gh-types",
      title: "GitHub event mix",
      series: entries.map(([, n]) => n),
      labels: entries.map(([k]) => k),
    };
  }

  return {
    sources: [...new Set(filtered.map((r) => r.source))],
    feed,
    metrics: metrics.slice(0, 4),
    chart,
    eventCount: filtered.length,
  };
}
