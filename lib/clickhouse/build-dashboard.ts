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
    kind?: "bar" | "line" | "area";
  };
  /** Raw payloads for specialized desks (weather / markets) */
  rich?: {
    weather?: Record<string, unknown>;
    markets?: Record<string, unknown>;
    fx?: Record<string, unknown>;
    wikipedia?: Record<string, unknown>;
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

  const rich: LiveDashboardData["rich"] = {};

  const weatherRow = filtered.find((r) => r.source === "weather");
  if (weatherRow) {
    rich.weather = parsePayload(weatherRow.payload);
  }

  const marketsRow = filtered.find(
    (r) => r.source === "markets" && r.event_type === "quote",
  );
  if (marketsRow) {
    rich.markets = parsePayload(marketsRow.payload);
  }

  const fxRow = filtered.find(
    (r) => r.source === "fx" && r.event_type === "rates",
  );
  if (fxRow) {
    rich.fx = parsePayload(fxRow.payload);
  }

  const wikiRow = filtered.find((r) => r.source === "wikipedia");
  if (wikiRow) {
    rich.wikipedia = parsePayload(wikiRow.payload);
  }

  const feed: LiveFeedItem[] = filtered
    .filter((r) => {
      // Avoid duplicate weather humidity/wind noise — only current
      if (r.source === "weather") return r.event_type === "current";
      if (r.source === "fx") return r.event_type === "rate" || r.event_type === "rates";
      return true;
    })
    .slice(0, 12)
    .map((row) => {
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
          typeof payload.meta === "string" ? payload.meta : null,
          typeof payload.by === "string" ? payload.by : null,
          typeof payload.location === "string" ? payload.location : null,
          typeof payload.changeLabel === "string" ? payload.changeLabel : null,
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

  if (rich.weather) {
    const p = rich.weather;
    const temp = p.temperature;
    const unit =
      typeof p.temperatureUnit === "string" ? p.temperatureUnit : "°C";
    const humidity = p.humidity;
    const wind = p.windSpeed;
    const location = typeof p.location === "string" ? p.location : "Weather";
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

  if (rich.markets) {
    const p = rich.markets;
    metrics.push({
      id: "metric-price",
      title: String(p.name ?? p.symbol ?? "Price"),
      value: String(p.price ?? "—"),
      unit: typeof p.currency === "string" ? p.currency : "USD",
    });
    if (p.change24h != null) {
      metrics.push({
        id: "metric-change",
        title: "Change",
        value: String(p.changeLabel ?? p.change24h),
        unit: typeof p.changeLabel === "string" ? undefined : "%",
      });
    }
  }

  if (rich.fx) {
    const p = rich.fx;
    const labels = Array.isArray(p.rateLabels)
      ? (p.rateLabels as string[])
      : Object.keys((p.rates as Record<string, number>) ?? {});
    const values = Array.isArray(p.rateValues)
      ? (p.rateValues as number[])
      : Object.values((p.rates as Record<string, number>) ?? {});
    labels.slice(0, 3).forEach((code, i) => {
      metrics.push({
        id: `metric-fx-${code}`,
        title: `1 ${p.base} → ${code}`,
        value: String(values[i] ?? "—"),
      });
    });
  }

  const hasGithubProfile = filtered.some(
    (row) => row.source === "github" && row.event_type === "profile",
  );
  if (
    !rich.weather &&
    !rich.markets &&
    !rich.fx &&
    !hasGithubProfile &&
    filtered.length > 0
  ) {
    metrics.push({
      id: "metric-events",
      title: "Live events",
      value: String(filtered.length),
    });
  }

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
  const githubProfile = githubRows.find((r) => r.event_type === "profile");
  if (githubProfile) {
    const p = parsePayload(githubProfile.payload);
    metrics.push(
      {
        id: "metric-gh-repos",
        title: "Public repos",
        value: String(p.public_repos ?? 0),
      },
      {
        id: "metric-gh-followers",
        title: "Followers",
        value: String(p.followers ?? 0),
      },
    );
  } else if (githubRows.length > 0) {
    metrics.push({
      id: "metric-gh",
      title: "GitHub events",
      value: String(githubRows.length),
    });
  }

  let chart: LiveDashboardData["chart"];

  if (
    rich.markets &&
    Array.isArray(rich.markets.sparklineValues) &&
    (rich.markets.sparklineValues as number[]).length >= 2
  ) {
    chart = {
      id: "chart-market",
      title: `${rich.markets.symbol ?? "Price"} · 7d`,
      series: rich.markets.sparklineValues as number[],
      labels: (rich.markets.sparklineLabels as string[]) ??
        (rich.markets.sparklineValues as number[]).map((_, i) => `D${i + 1}`),
      kind: "area",
    };
  } else if (
    rich.weather &&
    Array.isArray(rich.weather.hourlyTemps) &&
    (rich.weather.hourlyTemps as number[]).length >= 3
  ) {
    chart = {
      id: "chart-hourly",
      title: "Next hours",
      series: rich.weather.hourlyTemps as number[],
      labels: (rich.weather.hourlyLabels as string[]) ??
        (rich.weather.hourlyTemps as number[]).map((_, i) => `H${i + 1}`),
      kind: "area",
    };
  } else if (
    rich.fx &&
    Array.isArray(rich.fx.rateValues) &&
    (rich.fx.rateValues as number[]).length >= 2
  ) {
    chart = {
      id: "chart-fx",
      title: `${rich.fx.base} rates`,
      series: rich.fx.rateValues as number[],
      labels: (rich.fx.rateLabels as string[]) ?? [],
      kind: "bar",
    };
  } else if (hnScores.length >= 3) {
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
      kind: "bar",
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
      kind: "bar",
    };
  }

  return {
    sources: [...new Set(filtered.map((r) => r.source))],
    feed,
    metrics: metrics.slice(0, 4),
    chart,
    rich: Object.keys(rich).length ? rich : undefined,
    eventCount: filtered.length,
  };
}
