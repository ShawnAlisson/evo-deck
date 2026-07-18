import type { WorkspaceSnapshot, WorkspaceWidget } from "@/lib/workspace/snapshot";

export function slugifyName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "widget";
}

export function allocateName(desired: string, taken: Set<string>): string {
  const base = slugifyName(desired);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

export function widgetMention(name: string): string {
  return `@${slugifyName(name)}`;
}

/** Parse @mentions from a prompt against known widget names/ids. */
export function parseMentions(
  message: string,
  widgets: WorkspaceWidget[],
): WorkspaceWidget[] {
  const byKey = new Map<string, WorkspaceWidget>();
  for (const w of widgets) {
    byKey.set(slugifyName(w.name), w);
    byKey.set(slugifyName(w.id), w);
    if (w.title) byKey.set(slugifyName(w.title), w);
  }

  const found = new Map<string, WorkspaceWidget>();
  const re = /@([a-z0-9][a-z0-9-]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(message))) {
    const key = slugifyName(match[1] ?? "");
    const widget = byKey.get(key);
    if (widget) found.set(widget.id, widget);
  }
  return [...found.values()];
}

export type WidgetCatalogEntry = {
  id: string;
  name: string;
  title: string;
  type: string;
  summary: string;
};

export function summarizeWidget(widget: WorkspaceWidget): string {
  const props = widget.props ?? {};
  if (widget.type === "genui") {
    const response = typeof props.response === "string" ? props.response : "";
    return response.replace(/\s+/g, " ").trim().slice(0, 400);
  }
  if (widget.type === "note") {
    return String(props.body ?? "").slice(0, 200);
  }
  if (widget.type === "metric") {
    return `${props.value ?? ""}${props.unit ? ` ${props.unit}` : ""}`.trim();
  }
  try {
    return JSON.stringify(props).slice(0, 240);
  } catch {
    return "";
  }
}

export function buildWidgetCatalog(
  snapshot: WorkspaceSnapshot,
): WidgetCatalogEntry[] {
  return snapshot.widgets.map((w) => ({
    id: w.id,
    name: w.name,
    title: w.title,
    type: w.type,
    summary: summarizeWidget(w),
  }));
}

export function nextWidgetFrame(
  existing: WorkspaceWidget[],
  preferLarge = false,
): WorkspaceWidget["frame"] {
  if (preferLarge || existing.length === 0) {
    return { x: 0.04, y: 0.06, w: 0.56, h: 0.62, z: 20 };
  }
  const n = existing.length;
  const cols = 2;
  const col = n % cols;
  const row = Math.floor(n / cols) % 3;
  const maxZ = Math.max(10, ...existing.map((w) => w.frame.z));
  return {
    x: 0.04 + col * 0.48,
    y: 0.06 + row * 0.3,
    w: 0.44,
    h: 0.28,
    z: maxZ + 1,
  };
}

export function newWidgetId(prefix = "w"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Short human title + mention slug from a user prompt (never the whole sentence). */
export function suggestWidgetIdentity(
  message: string,
  preferredType?: string,
): { name: string; title: string } {
  const lower = message.toLowerCase();
  const typeHints: Array<{ re: RegExp; name: string; title: string }> = [
    { re: /\b(grocery|shopping)\b/, name: "grocery-list", title: "Grocery list" },
    { re: /\b(checklist|todo|to-?do|tasks?)\b/, name: "checklist", title: "Checklist" },
    { re: /\b(fruit|picker)\b/, name: "fruit-list", title: "Fruit list" },
    { re: /\b(signup|sign.?up|form)\b/, name: "signup-form", title: "Sign-up form" },
    { re: /\b(metric|arr|kpi|gauge)\b/, name: "metric", title: "Metric" },
    { re: /\b(kanban|board)\b/, name: "kanban", title: "Kanban board" },
    { re: /\b(flowchart|flow\s*chart|diagram)\b/, name: "flowchart", title: "Flowchart" },
    { re: /\b(calendar|meeting|schedule)\b/, name: "calendar", title: "Calendar" },
    { re: /\b(chart|graph|series)\b/, name: "chart", title: "Chart" },
    { re: /\b(feed|news|signals?)\b/, name: "feed", title: "Feed" },
    { re: /\b(note|memo)\b/, name: "note", title: "Note" },
  ];
  for (const hint of typeHints) {
    if (hint.re.test(lower)) return hint;
  }
  if (preferredType && preferredType !== "genui") {
    return {
      name: slugifyName(preferredType),
      title: preferredType.charAt(0).toUpperCase() + preferredType.slice(1),
    };
  }
  // Pull a few content words, skip filler
  const stop = new Set([
    "a",
    "an",
    "the",
    "make",
    "create",
    "add",
    "build",
    "show",
    "draw",
    "with",
    "and",
    "for",
    "to",
    "of",
    "my",
    "your",
    "please",
  ]);
  const words = lower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !stop.has(w))
    .slice(0, 3);
  const name = slugifyName(words.join("-") || "widget");
  const title = words.length
    ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
    : "Widget";
  return { name, title };
}
