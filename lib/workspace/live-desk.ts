import type { WorkspaceSnapshot } from "@/lib/workspace/snapshot";
import type { LiveDataBundle } from "@/lib/workspace/live-data";

/** Build OpenUI genui widgets from live adapter data (no native chart/feed/metric). */
export function snapshotFromLiveData(
  snapshot: WorkspaceSnapshot,
  live: LiveDataBundle,
): WorkspaceSnapshot {
  const keep = snapshot.widgets.filter((w) => !w.id.startsWith("live-"));
  const widgets = [...keep];
  let z = Math.max(0, ...widgets.map((w) => w.frame.z), 0) + 1;

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
      frame: { x: 0.04 + i * 0.24, y: 0.08, w: 0.22, h: 0.16, z: z++ },
      props: {
        response: [
          `root = Stack([t, v])`,
          `t = TextContent(${JSON.stringify(m.title)}, "small")`,
          `v = TextContent(${JSON.stringify(value)}, "large-heavy")`,
        ].join("\n"),
      },
    });
  });

  if (live.dashboard.chart) {
    const c = live.dashboard.chart;
    const labels = JSON.stringify(
      c.labels ?? c.series.map((_, i) => `P${i + 1}`),
    );
    const vals = JSON.stringify(c.series);
    widgets.push({
      id: `live-${c.id}`,
      type: "genui",
      name: `chart-${c.id}`.slice(0, 48),
      title: c.title,
      frame: { x: 0.04, y: 0.28, w: 0.42, h: 0.36, z: z++ },
      props: {
        response: [
          `root = Stack([title, chart])`,
          `title = TextContent(${JSON.stringify(c.title)}, "large-heavy")`,
          `labels = ${labels}`,
          `vals = ${vals}`,
          `s1 = Series("Series", vals)`,
          `chart = BarChart(labels, [s1], "grouped")`,
        ].join("\n"),
      },
    });
  }

  if (live.dashboard.feed.length > 0) {
    const isWeather =
      live.intent.kind === "sync" && live.intent.source === "weather";
    const title = isWeather ? "Conditions" : "Live signals";
    const lines = live.dashboard.feed.slice(0, 10).map((f, i) => {
      const text = f.meta ? `${f.title} — ${f.meta}` : f.title;
      return `item${i} = TextContent(${JSON.stringify(text)}, "small")`;
    });
    const kids = live.dashboard.feed
      .slice(0, 10)
      .map((_, i) => `item${i}`)
      .join(", ");
    widgets.push({
      id: "live-feed",
      type: "genui",
      name: isWeather ? "conditions" : "live-feed",
      title,
      frame: {
        x: live.dashboard.chart ? 0.5 : 0.04,
        y: metrics.length > 0 ? 0.28 : 0.08,
        w: live.dashboard.chart ? 0.46 : 0.7,
        h: 0.5,
        z: z++,
      },
      props: {
        response: [
          `root = Stack([heading, ${kids}], "column", "s")`,
          `heading = TextContent(${JSON.stringify(title)}, "large-heavy")`,
          ...lines,
        ].join("\n"),
      },
    });
  }

  if (widgets.length === keep.length) {
    widgets.push({
      id: "live-empty",
      type: "note",
      name: "live-empty",
      title: "Live data",
      frame: { x: 0.08, y: 0.12, w: 0.4, h: 0.2, z: z++ },
      props: { body: live.detail || "No live events returned." },
    });
  }

  return { version: 1, widgets };
}
