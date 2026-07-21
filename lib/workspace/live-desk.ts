import type { WorkspaceSnapshot } from "@/lib/workspace/snapshot";
import type { LiveDataBundle } from "@/lib/workspace/live-data";

function j(value: unknown) {
  return JSON.stringify(value);
}

function liveSourceKey(live: LiveDataBundle) {
  if (live.intent.kind === "sync") return live.intent.source;
  if (live.intent.kind === "research") return "research";
  return "fetch";
}

function liveRequest(live: LiveDataBundle) {
  if (live.intent.kind === "sync") {
    return live.intent.topic ?? `sync ${live.intent.source}`;
  }
  return live.intent.topic;
}

function belongsToLiveSource(
  widget: WorkspaceSnapshot["widgets"][number],
  source: string,
) {
  if (widget.props.__liveSource === source) return true;
  // Keep compatibility with desks created before source markers existed.
  return (
    (source === "markets" && widget.id === "live-markets") ||
    (source === "weather" && widget.id === "live-weather") ||
    (source === "fx" && widget.id === "live-fx") ||
    (source === "wikipedia" && widget.id === "live-wiki")
  );
}

function weatherDeskResponse(w: Record<string, unknown>): string {
  const location = String(w.location ?? "Weather");
  const condition = String(w.condition ?? w.summary ?? "Conditions");
  const emoji = String(w.emoji ?? "🌡️");
  const temp = w.temperature ?? "—";
  const unit = String(w.temperatureUnit ?? "°C");
  const feels = w.feelsLike;
  const humidity = w.humidity;
  const wind = w.windSpeed;
  const windUnit = String(w.windUnit ?? "km/h");
  const hourlyLabels = Array.isArray(w.hourlyLabels)
    ? (w.hourlyLabels as string[])
    : [];
  const hourlyTemps = Array.isArray(w.hourlyTemps)
    ? (w.hourlyTemps as number[])
    : [];

  const lines = [
    `root = Stack([hero, stats${hourlyTemps.length >= 3 ? ", chart" : ""}, src], "column", "m")`,
    `hero = Card([hdr, tempRow, cond], "sunk", "column", "s", "center")`,
    `hdr = CardHeader(${j(location)}, ${j(`${emoji} Live conditions`)})`,
    `tempRow = Stack([bigTemp, unitLabel], "row", "xs", "end", "center")`,
    `bigTemp = TextContent(${j(String(temp))}, "large-heavy")`,
    `unitLabel = TextContent(${j(unit)}, "small")`,
    `cond = Tag(${j(condition)}, null, "md", "info")`,
    `stats = Stack([hCard, wCard${feels != null ? ", fCard" : ""}], "row", "s", "stretch", "start", true)`,
    `hCard = Card([hLabel, hVal], "card", "column", "xs")`,
    `hLabel = TextContent("Humidity", "small")`,
    `hVal = TextContent(${j(`${humidity ?? "—"}%`)}, "large-heavy")`,
    `wCard = Card([wLabel, wVal], "card", "column", "xs")`,
    `wLabel = TextContent("Wind", "small")`,
    `wVal = TextContent(${j(`${wind ?? "—"} ${windUnit}`)}, "large-heavy")`,
  ];

  if (feels != null) {
    lines.push(
      `fCard = Card([fLabel, fVal], "card", "column", "xs")`,
      `fLabel = TextContent("Feels like", "small")`,
      `fVal = TextContent(${j(`${feels}${unit}`)}, "large-heavy")`,
    );
  }

  if (hourlyTemps.length >= 3) {
    lines.push(
      `chart = Card([cTitle, area], "clear", "column", "s")`,
      `cTitle = TextContent("Next hours", "small-heavy")`,
      `labels = ${j(hourlyLabels)}`,
      `vals = ${j(hourlyTemps)}`,
      `s1 = Series("Temp", vals)`,
      `area = AreaChart(labels, [s1], "natural", "Hour", ${j(`Temp (${unit})`)})`,
    );
  }

  lines.push(
    `src = TextContent("Open-Meteo · live", "small")`,
  );

  return lines.join("\n");
}

function marketsDeskResponse(m: Record<string, unknown>): string {
  const name = String(m.name ?? m.symbol ?? "Asset");
  const symbol = String(m.symbol ?? "");
  const price = m.price ?? "—";
  const currency = String(m.currency ?? "USD");
  const change = m.changeLabel ?? (m.change24h != null ? `${m.change24h}%` : null);
  const changeNum = typeof m.change24h === "number" ? m.change24h : 0;
  const tagVariant =
    changeNum > 0 ? "success" : changeNum < 0 ? "danger" : "neutral";
  const labels = Array.isArray(m.sparklineLabels)
    ? (m.sparklineLabels as string[])
    : [];
  const values = Array.isArray(m.sparklineValues)
    ? (m.sparklineValues as number[])
    : [];

  const lines = [
    `root = Stack([hero${values.length >= 2 ? ", chart" : ""}, meta], "column", "m")`,
    `hero = Card([hdr, priceRow${change ? ", chg" : ""}], "card", "column", "s")`,
    `hdr = CardHeader(${j(name)}, ${j(symbol ? `${symbol} · live quote` : "Live quote")})`,
    `priceRow = Stack([p, c], "row", "xs", "end", "center")`,
    `p = TextContent(${j(String(price))}, "large-heavy")`,
    `c = TextContent(${j(currency)}, "small")`,
  ];
  if (change) {
    lines.push(`chg = Tag(${j(String(change))}, null, "md", ${j(tagVariant)})`);
  }
  if (values.length >= 2) {
    lines.push(
      `chart = Card([ct, area], "sunk", "column", "s")`,
      `ct = TextContent("Recent trend", "small-heavy")`,
      `labels = ${j(labels)}`,
      `vals = ${j(values)}`,
      `s1 = Series(${j(symbol || name)}, vals)`,
      `area = AreaChart(labels, [s1], "natural")`,
    );
  }
  lines.push(`meta = TextContent(${j(m.kind === "crypto" ? "CoinGecko · live" : "Stooq · live")}, "small")`);
  return lines.join("\n");
}

function fxDeskResponse(fx: Record<string, unknown>): string {
  const base = String(fx.base ?? "USD");
  const labels = Array.isArray(fx.rateLabels)
    ? (fx.rateLabels as string[])
    : Object.keys((fx.rates as Record<string, number>) ?? {});
  const values = Array.isArray(fx.rateValues)
    ? (fx.rateValues as number[])
    : Object.values((fx.rates as Record<string, number>) ?? {});
  const date = String(fx.date ?? "");

  const cards = labels.slice(0, 4).map((code, i) => {
    return [
      `card${i} = Card([l${i}, v${i}], "card", "column", "xs")`,
      `l${i} = TextContent(${j(`1 ${base} → ${code}`)}, "small")`,
      `v${i} = TextContent(${j(String(values[i] ?? "—"))}, "large-heavy")`,
    ].join("\n");
  });

  const kids = labels.slice(0, 4).map((_, i) => `card${i}`).join(", ");

  return [
    `root = Stack([hdr, row${values.length >= 2 ? ", chart" : ""}, src], "column", "m")`,
    `hdr = CardHeader(${j(`${base} exchange`)}, ${j(date ? `As of ${date}` : "Live FX")})`,
    `row = Stack([${kids}], "row", "s", "stretch", "start", true)`,
    ...cards,
    ...(values.length >= 2
      ? [
          `chart = BarChart(${j(labels)}, [s1], "grouped")`,
          `s1 = Series(${j(base)}, ${j(values)})`,
        ]
      : []),
    `src = TextContent("Frankfurter · ECB reference", "small")`,
  ].join("\n");
}

function wikipediaDeskResponse(w: Record<string, unknown>): string {
  const title = String(w.title ?? "Wikipedia");
  const summary = String(w.summary ?? w.description ?? "").slice(0, 600);
  return [
    `root = Stack([card], "column", "m")`,
    `card = Card([hdr, body, src], "card", "column", "s")`,
    `hdr = CardHeader(${j(title)}, "Live lookup")`,
    `body = MarkDownRenderer(${j(summary)}, "clear")`,
    `src = TextContent("Wikipedia · summary", "small")`,
  ].join("\n");
}

/** Build OpenUI genui widgets from live adapter data (no native chart/feed/metric). */
export function snapshotFromLiveData(
  snapshot: WorkspaceSnapshot,
  live: LiveDataBundle,
): WorkspaceSnapshot {
  const sourceKey = liveSourceKey(live);
  const liveMeta = {
    __liveSource: sourceKey,
    __liveUpdatedAt: new Date().toISOString(),
    __liveVia: live.via,
    __liveRequest: liveRequest(live),
  };
  const keep = snapshot.widgets.filter((w) => !belongsToLiveSource(w, sourceKey));
  const widgets = [...keep];
  let z = Math.max(0, ...widgets.map((w) => w.frame.z), 0) + 1;

  const rich = live.dashboard.rich;

  // Specialized beautiful desks
  if (rich?.weather) {
    widgets.push({
      id: "live-weather",
      type: "genui",
      name: "weather",
      title: String(rich.weather.location ?? "Weather"),
      frame: { x: 0.06, y: 0.06, w: 0.55, h: 0.72, z: z++ },
      props: {
        ...liveMeta,
        response: weatherDeskResponse(rich.weather),
      },
    });
    return { version: 1, widgets };
  }

  if (rich?.markets) {
    widgets.push({
      id: "live-markets",
      type: "genui",
      name: "markets",
      title: String(rich.markets.name ?? "Markets"),
      frame: { x: 0.06, y: 0.06, w: 0.55, h: 0.68, z: z++ },
      props: {
        ...liveMeta,
        response: marketsDeskResponse(rich.markets),
      },
    });
    return { version: 1, widgets };
  }

  if (rich?.fx) {
    widgets.push({
      id: "live-fx",
      type: "genui",
      name: "fx-rates",
      title: `${rich.fx.base ?? "FX"} rates`,
      frame: { x: 0.06, y: 0.06, w: 0.58, h: 0.62, z: z++ },
      props: {
        ...liveMeta,
        response: fxDeskResponse(rich.fx),
      },
    });
    return { version: 1, widgets };
  }

  if (rich?.wikipedia) {
    widgets.push({
      id: "live-wiki",
      type: "genui",
      name: "wiki",
      title: String(rich.wikipedia.title ?? "Lookup"),
      frame: { x: 0.08, y: 0.08, w: 0.5, h: 0.55, z: z++ },
      props: {
        ...liveMeta,
        response: wikipediaDeskResponse(rich.wikipedia),
      },
    });
    return { version: 1, widgets };
  }

  const metrics = live.dashboard.metrics.slice(0, 3);
  metrics.forEach((m, i) => {
    const value =
      m.unit && !String(m.value).includes(m.unit)
        ? `${m.value}${m.unit}`
        : String(m.value);
    widgets.push({
      id: `live-${m.id}`,
      type: "genui",
      name: `metric-${m.id}`.replace(/[^a-z0-9-]/gi, "-").slice(0, 48),
      title: m.title,
      frame: { x: 0.04 + i * 0.24, y: 0.08, w: 0.22, h: 0.18, z: z++ },
      props: {
        ...liveMeta,
        response: [
          `root = Stack([card])`,
          `card = Card([t, v], "card", "column", "xs")`,
          `t = TextContent(${j(m.title)}, "small")`,
          `v = TextContent(${j(value)}, "large-heavy")`,
        ].join("\n"),
      },
    });
  });

  if (live.dashboard.chart) {
    const c = live.dashboard.chart;
    const labels = j(c.labels ?? c.series.map((_, i) => `P${i + 1}`));
    const vals = j(c.series);
    const kind = c.kind ?? "bar";
    const chartExpr =
      kind === "area"
        ? `chart = AreaChart(labels, [s1], "natural")`
        : kind === "line"
          ? `chart = LineChart(labels, [s1], "natural")`
          : `chart = BarChart(labels, [s1], "grouped")`;
    widgets.push({
      id: `${sourceKey}-chart-${c.id}`,
      type: "genui",
      name: `chart-${c.id}`.slice(0, 48),
      title: c.title,
      frame: { x: 0.04, y: 0.3, w: 0.42, h: 0.4, z: z++ },
      props: {
        ...liveMeta,
        response: [
          `root = Stack([title, chart])`,
          `title = TextContent(${j(c.title)}, "large-heavy")`,
          `labels = ${labels}`,
          `vals = ${vals}`,
          `s1 = Series("Series", vals)`,
          chartExpr,
        ].join("\n"),
      },
    });
  }

  if (live.dashboard.feed.length > 0) {
    const title = "Live signals";
    const lines = live.dashboard.feed.slice(0, 10).map((f, i) => {
      const text = f.meta ? `${f.title} — ${f.meta}` : f.title;
      return `item${i} = TextContent(${j(text)}, "small")`;
    });
    const kids = live.dashboard.feed
      .slice(0, 10)
      .map((_, i) => `item${i}`)
      .join(", ");
    widgets.push({
      id: `${sourceKey}-feed`,
      type: "genui",
      name: "live-feed",
      title,
      frame: {
        x: live.dashboard.chart ? 0.5 : 0.04,
        y: metrics.length > 0 ? 0.3 : 0.08,
        w: live.dashboard.chart ? 0.46 : 0.7,
        h: 0.5,
        z: z++,
      },
      props: {
        ...liveMeta,
        response: [
          `root = Stack([heading, ${kids}], "column", "s")`,
          `heading = TextContent(${j(title)}, "large-heavy")`,
          ...lines,
        ].join("\n"),
      },
    });
  }

  if (widgets.length === keep.length) {
    widgets.push({
      id: `${sourceKey}-empty`,
      type: "note",
      name: "live-empty",
      title: "Live data",
      frame: { x: 0.08, y: 0.12, w: 0.4, h: 0.2, z: z++ },
      props: {
        ...liveMeta,
        body: live.detail || "No live events returned.",
      },
    });
  }

  return { version: 1, widgets };
}
