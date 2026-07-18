import {
  createLibrary,
  defineComponent,
  type ElementNode,
} from "@openuidev/lang-core";
import { z } from "zod/v4";

/** Stub renderer — server only needs schemas/prompts/parser, not React. */
const noop = () => null;

/** Shared frame props — normalized 0–1 canvas coordinates. */
const frameFields = {
  x: z.number().describe("Left edge 0–1"),
  y: z.number().describe("Top edge 0–1"),
  w: z.number().describe("Width 0–1"),
  h: z.number().describe("Height 0–1"),
  z: z.number().describe("Stacking order"),
};

const MetricWidget = defineComponent({
  name: "Metric",
  description:
    "Single KPI card. Use ONLY for a concrete numeric value the user asked about or that already exists. Never invent fake KPIs for explanations.",
  props: z.object({
    id: z.string(),
    title: z.string(),
    ...frameFields,
    value: z.string(),
    unit: z.string().optional(),
    delta: z.string().optional(),
  }),
  component: noop,
});

const NoteWidget = defineComponent({
  name: "Note",
  description:
    "Plain-text card for definitions and explanations. No LaTeX, no markdown — write sin(θ) = opposite / hypotenuse. Default for 'what is / explain' questions; one Note is often enough.",
  props: z.object({
    id: z.string(),
    title: z.string(),
    ...frameFields,
    body: z.string(),
  }),
  component: noop,
});

const ChartWidget = defineComponent({
  name: "Chart",
  description:
    "Bar chart from a REAL numeric series (user-provided or live ClickHouse aggregates). Never invent decorative values.",
  props: z.object({
    id: z.string(),
    title: z.string(),
    ...frameFields,
    series: z.array(z.number()),
    labels: z.array(z.string()).optional(),
  }),
  component: noop,
});

const FeedItem = defineComponent({
  name: "FeedItem",
  description: "One row in a feed widget.",
  props: z.object({
    title: z.string(),
    meta: z.string().optional(),
    url: z.string().optional(),
  }),
  component: noop,
});

const FeedWidget = defineComponent({
  name: "Feed",
  description:
    "Scrollable list of news / signals / links. Primary widget for live HN/RSS/GitHub items from ClickHouse.",
  props: z.object({
    id: z.string(),
    title: z.string(),
    ...frameFields,
    items: z.array(FeedItem.ref),
  }),
  component: noop,
});

const KanbanColumn = defineComponent({
  name: "KanbanColumn",
  description: "One kanban column with card titles.",
  props: z.object({
    id: z.string(),
    title: z.string(),
    cards: z.array(z.string()),
  }),
  component: noop,
});

const KanbanWidget = defineComponent({
  name: "Kanban",
  description:
    "Kanban board. Use for tasks / workflows the user asked to organize — not for Q&A.",
  props: z.object({
    id: z.string(),
    title: z.string(),
    ...frameFields,
    columns: z.array(KanbanColumn.ref),
  }),
  component: noop,
});

const CalendarEvent = defineComponent({
  name: "CalendarEvent",
  description: "Calendar event row.",
  props: z.object({
    title: z.string(),
    day: z.string(),
  }),
  component: noop,
});

const CalendarWidget = defineComponent({
  name: "Calendar",
  description:
    "Upcoming events list. Use only for schedules / dates the user cares about.",
  props: z.object({
    id: z.string(),
    title: z.string(),
    ...frameFields,
    events: z.array(CalendarEvent.ref),
  }),
  component: noop,
});

const FlowNode = defineComponent({
  name: "FlowNode",
  description: "One flowchart node. kind: start | decision | process | end.",
  props: z.object({
    id: z.string(),
    label: z.string(),
    kind: z.enum(["start", "decision", "process", "end"]).optional(),
  }),
  component: noop,
});

const FlowEdge = defineComponent({
  name: "FlowEdge",
  description: "Arrow between flowchart nodes. Optional label on the branch.",
  props: z.object({
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
  }),
  component: noop,
});

const FlowchartWidget = defineComponent({
  name: "Flowchart",
  description:
    "Decision tree / flowchart. Use for flowchart, decision tree, branching process requests. Prefer ONE Flowchart over notes.",
  props: z.object({
    id: z.string(),
    title: z.string(),
    ...frameFields,
    nodes: z.array(FlowNode.ref),
    edges: z.array(FlowEdge.ref),
  }),
  component: noop,
});

const widgetUnion = z.union([
  MetricWidget.ref,
  NoteWidget.ref,
  ChartWidget.ref,
  FeedWidget.ref,
  KanbanWidget.ref,
  CalendarWidget.ref,
  FlowchartWidget.ref,
]);

export const CanvasRoot = defineComponent({
  name: "Canvas",
  description:
    "Absolute-positioned Echoes workspace root. message = short assistant reply answering the user; widgets = ONLY the widgets needed for this request (often just 1).",
  props: z.object({
    message: z.string(),
    widgets: z.array(widgetUnion),
  }),
  component: noop,
});

export const echoesLibrary = createLibrary({
  root: "Canvas",
  components: [
    CanvasRoot,
    MetricWidget,
    NoteWidget,
    ChartWidget,
    FeedWidget,
    FeedItem,
    KanbanWidget,
    KanbanColumn,
    CalendarWidget,
    CalendarEvent,
    FlowchartWidget,
    FlowNode,
    FlowEdge,
  ],
  componentGroups: [
    {
      name: "Workspace",
      components: ["Canvas"],
      notes: [
        "- Always start with root = Canvas(...).",
        "- Emit the FULL desired widget list (not a diff).",
        "- Match widget count to intent: 1 Flowchart for flowchart requests; 1 Note for definitions.",
        "- Keep frames in 0–1 and avoid heavy overlap.",
        "- Reuse stable widget ids when updating existing widgets.",
      ],
    },
    {
      name: "Widgets",
      components: [
        "Metric",
        "Note",
        "Chart",
        "Feed",
        "FeedItem",
        "Kanban",
        "KanbanColumn",
        "Calendar",
        "CalendarEvent",
        "Flowchart",
        "FlowNode",
        "FlowEdge",
      ],
      notes: [
        "- Define EACH widget as its own named statement for streaming.",
        "- Prefer the fewest widgets that satisfy the request.",
        "- For flowchart/decision-tree requests: emit a Flowchart, never a Note of the prompt.",
      ],
    },
  ],
});

export function isElementNode(value: unknown): value is ElementNode {
  return (
    !!value &&
    typeof value === "object" &&
    (value as ElementNode).type === "element" &&
    typeof (value as ElementNode).typeName === "string"
  );
}
