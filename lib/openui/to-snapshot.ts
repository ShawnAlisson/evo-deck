import { createParser, type ElementNode, type ParseResult } from "@openuidev/lang-core";
import {
  emptySnapshot,
  type WorkspaceSnapshot,
  type WorkspaceWidget,
  type WidgetType,
  workspaceSnapshotSchema,
} from "@/lib/workspace/snapshot";
import { evoDeckLibrary, isElementNode } from "@/lib/openui/library";
import { sanitizePlainText } from "@/lib/openui/plain-text";
import { slugifyName } from "@/lib/workspace/naming";

const parser = createParser(evoDeckLibrary.toJSONSchema(), "Canvas");

function num(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function frameFromProps(props: Record<string, unknown>) {
  return {
    x: Math.min(1, Math.max(0, num(props.x))),
    y: Math.min(1, Math.max(0, num(props.y))),
    w: Math.min(1, Math.max(0.05, num(props.w, 0.2))),
    h: Math.min(1, Math.max(0.05, num(props.h, 0.2))),
    z: num(props.z, 1),
  };
}

function elementToWidget(node: ElementNode): WorkspaceWidget | null {
  const id = str(node.props.id, node.statementId ?? "");
  if (!id) return null;
  const title = str(node.props.title, node.typeName);
  const frame = frameFromProps(node.props);
  const base = { id, name: slugifyName(title || id), title, frame };

  switch (node.typeName as string) {
    case "Metric":
      return {
        ...base,
        type: "metric",
        props: {
          value: str(node.props.value, "—"),
          unit: str(node.props.unit) || undefined,
          delta: str(node.props.delta) || undefined,
        },
      };
    case "Note":
      return {
        ...base,
        type: "note",
        props: { body: sanitizePlainText(str(node.props.body)) },
      };
    case "Chart":
      return {
        ...base,
        type: "chart",
        props: {
          series: Array.isArray(node.props.series)
            ? node.props.series.filter((n): n is number => typeof n === "number")
            : [],
          labels: Array.isArray(node.props.labels)
            ? node.props.labels.filter((n): n is string => typeof n === "string")
            : undefined,
        },
      };
    case "Feed": {
      const items = Array.isArray(node.props.items)
        ? node.props.items
            .filter(isElementNode)
            .map((item) => ({
              title: str(item.props.title, "Item"),
              meta: str(item.props.meta) || undefined,
              url: str(item.props.url) || undefined,
            }))
        : [];
      return { ...base, type: "feed", props: { items } };
    }
    case "Kanban": {
      const columns = Array.isArray(node.props.columns)
        ? node.props.columns
            .filter(isElementNode)
            .map((col) => ({
              id: str(col.props.id, col.statementId ?? "col"),
              title: str(col.props.title, "Column"),
              cards: Array.isArray(col.props.cards)
                ? col.props.cards.filter((c): c is string => typeof c === "string")
                : [],
            }))
        : [];
      return { ...base, type: "kanban", props: { columns } };
    }
    case "Calendar": {
      const events = Array.isArray(node.props.events)
        ? node.props.events
            .filter(isElementNode)
            .map((ev) => ({
              title: str(ev.props.title, "Event"),
              day: str(ev.props.day, ""),
            }))
        : [];
      return { ...base, type: "calendar", props: { events } };
    }
    case "Flowchart": {
      const nodes = Array.isArray(node.props.nodes)
        ? node.props.nodes
            .filter(isElementNode)
            .map((n) => ({
              id: str(n.props.id, n.statementId ?? "node"),
              label: str(n.props.label, "Step"),
              kind: (["start", "decision", "process", "end"].includes(
                str(n.props.kind),
              )
                ? str(n.props.kind)
                : "process") as "start" | "decision" | "process" | "end",
            }))
        : [];
      const edges = Array.isArray(node.props.edges)
        ? node.props.edges
            .filter(isElementNode)
            .map((e) => ({
              from: str(e.props.from),
              to: str(e.props.to),
              label: str(e.props.label) || undefined,
            }))
            .filter((e) => e.from && e.to)
        : [];
      if (nodes.length === 0) return null;
      return { ...base, type: "flowchart", props: { nodes, edges } };
    }
    default:
      return null;
  }
}

/** Strip markdown fences / prose wrappers models sometimes add. */
export function normalizeOpenUiResponse(text: string): string {
  let raw = text.trim();
  const fenced = raw.match(/```(?:openui|lang)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) raw = fenced[1].trim();

  // If prose precedes statements, keep from the first assignment line.
  const lines = raw.split("\n");
  const start = lines.findIndex((line) => /^\s*(?:root|\$?\w+)\s*=/.test(line));
  if (start > 0) raw = lines.slice(start).join("\n").trim();
  return raw;
}

export function parseOpenUiToWorkspace(text: string): {
  assistantMessage: string;
  snapshot: WorkspaceSnapshot;
  parseResult: ParseResult;
} {
  const parseResult = parser.parse(normalizeOpenUiResponse(text));
  const root = parseResult.root;
  const parseErrors = parseResult.meta?.errors ?? [];

  if (!root || root.typeName !== "Canvas") {
    const detail =
      parseErrors.length > 0
        ? `: ${JSON.stringify(parseErrors).slice(0, 400)}`
        : "";
    throw new Error(`OpenUI output missing Canvas root${detail}`);
  }

  const widgetsRaw = Array.isArray(root.props.widgets) ? root.props.widgets : [];
  const widgets = widgetsRaw
    .filter(isElementNode)
    .map(elementToWidget)
    .filter((w): w is WorkspaceWidget => !!w);

  const snapshot = workspaceSnapshotSchema.parse({
    version: 1,
    widgets,
  });

  return {
    assistantMessage: sanitizePlainText(
      str(root.props.message, "Updated the canvas."),
    ),
    snapshot,
    parseResult,
  };
}

export function buildOpenUiSystemPrompt(hasLiveData = false) {
  const liveRules = hasLiveData
    ? `LIVE DATA MODE (Trigger.dev → ClickHouse → canvas):
- The user turn includes real metrics, feed items, and optional chart series.
- Build a visual desk: Metric + Feed + Chart (when chart data exists). A short Note or Kanban is OK for collaboration.
- NEVER invent headlines, scores, or series. Copy numbers/titles from the live data JSON.
- Prefer widgets over paragraphs. Canvas.message should be one short sentence about what you laid out.`
    : `Intent routing:
- Flowchart / decision tree / branching diagram → ONE Flowchart widget (nodes + edges). Never paste the prompt into a Note.
- Explanation / definition / "what is" → usually ONE plain-text Note. No decorative charts.
- Dashboard / board / desk requests without live data → compose widgets the user asked for.
- Never invent chart series.`;

  return evoDeckLibrary.prompt({
    preamble: `You are EvoDeck, an AI that builds a live absolute-positioned workspace canvas with OpenUI Lang.
Output ONLY OpenUI Lang (no markdown fences, no prose outside OpenUI statements).
Widgets use normalized frames (x,y,w,h,z) in 0–1 space.

PLAIN TEXT ONLY in Canvas.message and Note.body (no LaTeX, no markdown).

${liveRules}`,
    additionalRules: [
      "Always define root = Canvas(message, widgets) first, then child statements.",
      "Rebuild the full desired layout each turn (include widgets you want to keep).",
      "Reuse existing widget ids from the current snapshot when updating them.",
      "Never invent unsafe HTML or scripts — only use library components.",
      "In OpenUI strings, use \\n for newlines. Do not put backslash LaTeX commands in strings.",
    ],
    examples: hasLiveData
      ? [
          `root = Canvas("Live HN desk from ClickHouse — scores and top stories.", [m1, m2, chart1, feed1])
m1 = Metric("live-metric-events", "Live events", 0.04, 0.08, 0.2, 0.16, 1, "20")
m2 = Metric("live-metric-top-score", "Top score", 0.28, 0.08, 0.2, 0.16, 2, "812")
chart1 = Chart("live-chart-hn-scores", "HN score distribution", 0.04, 0.28, 0.42, 0.34, 3, [3, 5, 4, 2, 1, 1], ["0-49", "50-99", "100-199", "200-399", "400-799", "800+"])
feed1 = Feed("live-feed", "Top stories", 0.5, 0.28, 0.46, 0.5, 4, [item1, item2])
item1 = FeedItem("Example story", "hackernews · 812 pts", "https://example.com")
item2 = FeedItem("Another story", "hackernews · 420 pts", "https://example.com")`,
        ]
      : [
          `root = Canvas("Decision flowchart for fruit, pie, then evening.", [flow1])
flow1 = Flowchart("fruit-flow", "Fruit evening", 0.08, 0.08, 0.84, 0.78, 1, [n1, n2, n3, n4, n5], [e1, e2, e3, e4])
n1 = FlowNode("start", "Choose fruit", "start")
n2 = FlowNode("fruit", "Banana or apple?", "decision")
n3 = FlowNode("apple-pie", "Make apple pie", "process")
n4 = FlowNode("banana-pie", "Make banana pie", "process")
n5 = FlowNode("sleep", "Sleep", "end")
e1 = FlowEdge("start", "fruit")
e2 = FlowEdge("fruit", "apple-pie", "apple")
e3 = FlowEdge("fruit", "banana-pie", "banana")
e4 = FlowEdge("apple-pie", "sleep")`,
          `root = Canvas("Sine (sin) is opposite over hypotenuse; on the unit circle it is the y-coordinate.", [note1])
note1 = Note("sine", "Sine", 0.1, 0.12, 0.55, 0.42, 1, "Definition: sin(θ) = opposite / hypotenuse.\\n\\nUnit circle: sin(θ) is the y-coordinate.\\n\\nRange: -1 to 1. Period: 2π.")`,
        ],
    toolCalls: false,
    bindings: false,
  });
}

export function mergeIfEmpty(
  next: WorkspaceSnapshot,
  fallbackMessage: string,
  seed?: WorkspaceSnapshot,
): { assistantMessage: string; snapshot: WorkspaceSnapshot } {
  if (next.widgets.length > 0) {
    return { assistantMessage: fallbackMessage, snapshot: next };
  }
  return {
    assistantMessage: fallbackMessage,
    snapshot: seed ?? emptySnapshot(),
  };
}

export type { WidgetType };
