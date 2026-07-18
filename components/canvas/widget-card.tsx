"use client";

import type { ActionEvent } from "@openuidev/react-lang";
import { useEffect, useState } from "react";
import type { WorkspaceWidget } from "@/lib/workspace/snapshot";
import type { FlowEdge, FlowNode } from "@/lib/workspace/flowchart";
import { GenUiPanel } from "@/components/canvas/genui-panel";

function asString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

/** Cheap remount key so OpenUI bindings reset when response/uiState change. */
function hashUi(
  response: string,
  uiState: Record<string, unknown> | undefined,
) {
  const stateKey = uiState ? JSON.stringify(uiState) : "";
  let h = 0;
  const s = response + "|" + stateKey;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function cardLabel(card: unknown): string {
  if (typeof card === "string") return card;
  if (card && typeof card === "object") {
    const row = card as { title?: unknown; name?: unknown; label?: unknown };
    if (typeof row.title === "string" && row.title.trim()) return row.title;
    if (typeof row.name === "string" && row.name.trim()) return row.name;
    if (typeof row.label === "string" && row.label.trim()) return row.label;
  }
  return "Card";
}

function asNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((n) => {
      if (typeof n === "number" && Number.isFinite(n)) return n;
      if (typeof n === "string" && n.trim() && Number.isFinite(Number(n))) {
        return Number(n);
      }
      return null;
    })
    .filter((n): n is number => n != null);
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    return "";
  });
}

export function WidgetCard({
  widget,
  selected,
  onPointerDown,
  onUiState,
  onAction,
}: {
  widget: WorkspaceWidget;
  selected?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onUiState?: (state: Record<string, unknown>) => void;
  onAction?: (event: ActionEvent) => void;
}) {
  const mention = widget.name || widget.id;

  return (
    <div
      className={`echo-widget ${selected ? "is-selected" : ""} ${widget.type === "genui" ? "is-genui" : ""}`}
      onPointerDown={onPointerDown}
      data-widget-id={widget.id}
    >
      <header className="echo-widget-head" data-drag-handle>
        <div className="echo-widget-head-main">
          <span className="echo-widget-mention">@{mention}</span>
        </div>
      </header>
      <div className="echo-widget-body" data-no-drag>
        {renderBody(widget, onUiState, onAction)}
      </div>
      <div className="echo-resize-handle" data-resize />
    </div>
  );
}

function renderBody(
  widget: WorkspaceWidget,
  onUiState?: (state: Record<string, unknown>) => void,
  onAction?: (event: ActionEvent) => void,
) {
  switch (widget.type) {
    case "metric": {
      const value = asString(widget.props.value, "—");
      const unit = asString(widget.props.unit);
      const delta = asString(widget.props.delta);
      return (
        <div className="echo-metric">
          <strong>
            {value}
            {unit ? <span>{unit}</span> : null}
          </strong>
          {delta ? <small>{delta}</small> : null}
        </div>
      );
    }
    case "clock":
      return (
        <LiveClock
          timezone={asString(widget.props.timezone)}
          format={asString(widget.props.format, "24h")}
        />
      );
    case "note":
      return <p className="echo-note">{asString(widget.props.body, "…")}</p>;
    case "chart": {
      const series = asNumberArray(widget.props.series);
      const labels = asStringArray(widget.props.labels);
      const kind = chartKind(widget.props.kind ?? widget.props.variant);
      if (series.length === 0) {
        return <p className="echo-note">No chart data</p>;
      }
      if (kind === "line" || kind === "area") {
        return (
          <LineAreaChart
            series={series}
            labels={labels}
            kind={kind}
            title={widget.title}
          />
        );
      }
      const max = Math.max(...series, 1);
      return (
        <div className="echo-chart">
          {series.map((n, i) => (
            <div
              key={i}
              className="echo-chart-col"
              title={`${labels[i] ?? i + 1}: ${n}`}
            >
              <span className="echo-chart-value">{formatChartValue(n)}</span>
              <div
                className="echo-chart-bar"
                style={{ height: `${Math.max(8, (n / max) * 100)}%` }}
              />
              <span className="echo-chart-label">
                {labels[i]?.trim() || String(i + 1)}
              </span>
            </div>
          ))}
        </div>
      );
    }
    case "feed": {
      const items = Array.isArray(widget.props.items) ? widget.props.items : [];
      return (
        <ul className="echo-feed">
          {items.map((item, i) => {
            const row = item as {
              title?: unknown;
              meta?: unknown;
              url?: unknown;
            };
            const title = cardLabel(row.title ?? item);
            const meta = typeof row.meta === "string" ? row.meta : "";
            const url = typeof row.url === "string" ? row.url : "";
            return (
              <li key={i}>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer">
                    {title}
                  </a>
                ) : (
                  <span>{title}</span>
                )}
                {meta ? <small>{meta}</small> : null}
              </li>
            );
          })}
        </ul>
      );
    }
    case "kanban": {
      const columns = Array.isArray(widget.props.columns)
        ? widget.props.columns
        : [];
      return (
        <div className="echo-kanban">
          {columns.map((col, i) => {
            const c = col as {
              title?: string;
              name?: string;
              cards?: unknown[];
            };
            return (
              <div key={i}>
                <strong>{c.title ?? c.name ?? "Column"}</strong>
                {(c.cards ?? []).map((card, j) => (
                  <span key={j}>{cardLabel(card)}</span>
                ))}
              </div>
            );
          })}
        </div>
      );
    }
    case "calendar": {
      const events = Array.isArray(widget.props.events) ? widget.props.events : [];
      return (
        <ul className="echo-feed">
          {events.map((ev, i) => {
            const e = ev as { title?: string; day?: string };
            return (
              <li key={i}>
                <span>{e.title ?? "Event"}</span>
                {e.day ? <small>{e.day}</small> : null}
              </li>
            );
          })}
        </ul>
      );
    }
    case "flowchart": {
      const nodes = (
        Array.isArray(widget.props.nodes) ? widget.props.nodes : []
      ) as FlowNode[];
      const edges = (
        Array.isArray(widget.props.edges) ? widget.props.edges : []
      ) as FlowEdge[];
      return <FlowchartView nodes={nodes} edges={edges} />;
    }
    case "genui": {
      const response = asString(widget.props.response);
      if (!response.trim()) {
        return <p className="echo-note">Empty generative UI</p>;
      }
      const uiState =
        widget.props.uiState && typeof widget.props.uiState === "object"
          ? (widget.props.uiState as Record<string, unknown>)
          : undefined;
      return (
        <GenUiPanel
          key={`${widget.id}:${response.length}:${hashUi(response, uiState)}`}
          response={response}
          initialState={uiState}
          onStateUpdate={onUiState}
          onAction={onAction}
        />
      );
    }
    default:
      return <p className="echo-note">Unsupported widget</p>;
  }
}

function LiveClock({
  timezone,
  format,
}: {
  timezone: string;
  format: string;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: format.toLowerCase() === "12h",
    ...(timezone ? { timeZone: timezone } : {}),
  };
  let label = "--:--";
  try {
    label = new Intl.DateTimeFormat(undefined, options).format(now);
  } catch {
    // Invalid user-provided timezones fall back to the browser's local time.
    label = new Intl.DateTimeFormat(undefined, {
      ...options,
      timeZone: undefined,
    }).format(now);
  }

  return (
    <div className="echo-metric echo-clock" aria-live="polite">
      <strong>{label}</strong>
      {timezone ? <small>{timezone}</small> : null}
    </div>
  );
}

function formatChartValue(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}k`;
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function chartKind(raw: unknown): "bar" | "line" | "area" {
  const v = String(raw ?? "bar").toLowerCase();
  if (v === "line" || v === "area") return v;
  return "bar";
}

function LineAreaChart({
  series,
  labels,
  kind,
  title,
}: {
  series: number[];
  labels: string[];
  kind: "line" | "area";
  title: string;
}) {
  const padX = 28;
  const padY = 18;
  const w = 360;
  const h = 160;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(max - min, 1e-6);
  const points = series.map((n, i) => {
    const x =
      padX +
      (series.length === 1 ? 0 : (i / (series.length - 1)) * (w - padX * 2));
    const y = padY + (1 - (n - min) / span) * (h - padY * 2);
    return { x, y, n, label: labels[i]?.trim() || String(i + 1) };
  });
  const poly = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${padX},${h - padY} ${poly} ${w - padX},${h - padY}`;

  return (
    <div className="echo-line-chart">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="echo-line-chart-svg"
        role="img"
        aria-label={title}
      >
        <line
          className="echo-line-chart-axis"
          x1={padX}
          y1={h - padY}
          x2={w - padX}
          y2={h - padY}
        />
        <line
          className="echo-line-chart-axis"
          x1={padX}
          y1={padY}
          x2={padX}
          y2={h - padY}
        />
        {kind === "area" ? (
          <polygon className="echo-line-chart-area" points={area} />
        ) : null}
        <polyline
          className="echo-line-chart-line"
          points={poly}
          fill="none"
        />
        {points.map((p, i) => (
          <g key={i}>
            <circle className="echo-line-chart-dot" cx={p.x} cy={p.y} r={3.2} />
            <text
              className="echo-line-chart-value"
              x={p.x}
              y={p.y - 8}
              textAnchor="middle"
            >
              {formatChartValue(p.n)}
            </text>
            {i === 0 ||
            i === points.length - 1 ||
            i % Math.ceil(points.length / 4) === 0 ? (
              <text
                className="echo-line-chart-label"
                x={p.x}
                y={h - 4}
                textAnchor="middle"
              >
                {p.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

function layoutFlow(nodes: FlowNode[], edges: FlowEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, 0);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    // Skip self-loops — they don't affect layout and confuse leveling
    if (e.from === e.to) continue;
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    outgoing.get(e.from)?.push(e.to);
  }

  const roots = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
  const start = roots.length > 0 ? roots : nodes.slice(0, 1);
  const level = new Map<string, number>();
  const queue = start.map((n) => n.id);
  for (const id of queue) level.set(id, 0);

  // First visit wins. Re-queueing on level increases loops forever on cycles.
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const depth = level.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      if (level.has(next)) continue;
      level.set(next, depth + 1);
      queue.push(next);
    }
  }

  for (const n of nodes) {
    if (!level.has(n.id)) level.set(n.id, 0);
  }

  const rows = new Map<number, string[]>();
  for (const [id, d] of level) {
    const list = rows.get(d) ?? [];
    list.push(id);
    rows.set(d, list);
  }

  const maxDepth = Math.min(
    nodes.length,
    Math.max(0, ...level.values()),
  );
  const colGap = 160;
  const rowGap = 110;
  const nodeW = 132;
  const nodeH = 52;
  const positions = new Map<string, { x: number; y: number }>();

  for (let d = 0; d <= maxDepth; d++) {
    const ids = rows.get(d) ?? [];
    const width = Math.max(ids.length, 1) * colGap;
    ids.forEach((id, i) => {
      positions.set(id, {
        x: i * colGap + (colGap - nodeW) / 2 + (400 - width) / 2 + 40,
        y: d * rowGap + 24,
      });
    });
  }

  const height = (maxDepth + 1) * rowGap + 40;
  const width = Math.max(
    480,
    ...[...positions.values()].map((p) => p.x + nodeW + 40),
    0,
  );

  return { positions, width, height, nodeW, nodeH };
}

function FlowchartView({
  nodes,
  edges,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
}) {
  if (nodes.length === 0) {
    return <p className="echo-note">Empty flowchart</p>;
  }

  const { positions, width, height, nodeW, nodeH } = layoutFlow(nodes, edges);

  return (
    <div className="echo-flow">
      <svg viewBox={`0 0 ${width} ${height}`} className="echo-flow-svg">
        <defs>
          <marker
            id="echo-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--flow-edge)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + nodeW / 2;
          const y1 = a.y + nodeH;
          const x2 = b.x + nodeW / 2;
          const y2 = b.y;
          const midY = (y1 + y2) / 2;
          return (
            <g key={`${e.from}-${e.to}-${i}`}>
              <path
                className="echo-flow-edge"
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                strokeWidth="1.6"
                markerEnd="url(#echo-arrow)"
              />
              {e.label ? (
                <text
                  x={(x1 + x2) / 2}
                  y={midY - 4}
                  textAnchor="middle"
                  className="echo-flow-edge-label"
                >
                  {e.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const kind = n.kind ?? "process";
          return (
            <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
              {kind === "decision" ? (
                <polygon
                  points={`${nodeW / 2},0 ${nodeW},${nodeH / 2} ${nodeW / 2},${nodeH} 0,${nodeH / 2}`}
                  className={`echo-flow-node is-${kind}`}
                />
              ) : (
                <rect
                  width={nodeW}
                  height={nodeH}
                  rx={kind === "start" || kind === "end" ? 24 : 10}
                  className={`echo-flow-node is-${kind}`}
                />
              )}
              <foreignObject width={nodeW} height={nodeH}>
                <div className="echo-flow-label">{n.label}</div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
