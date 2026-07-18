import { z } from "zod";
import { chatComplete } from "@/lib/llm";
import {
  applyOps,
  normalizeSnapshot,
  workspaceOpSchema,
  type WorkspaceOp,
  type WorkspaceSnapshot,
  type WorkspaceWidget,
} from "@/lib/workspace/snapshot";
import {
  assertValidGenUi,
  buildGenUiSystemPrompt,
} from "@/lib/openui/genui";
import type { LiveDataBundle } from "@/lib/workspace/live-data";
import { snapshotFromLiveData } from "@/lib/workspace/live-desk";
import {
  allocateName,
  buildWidgetCatalog,
  newWidgetId,
  nextWidgetFrame,
  parseMentions,
  slugifyName,
  suggestWidgetIdentity,
} from "@/lib/workspace/naming";
import {
  applyChecklistEditToOpenUi,
  detectChecklistEditIntent,
  widgetHasChecklist,
} from "@/lib/workspace/checklist-edit";
import {
  generateFlowchartJson,
  heuristicFruitEveningFlow,
  isFlowchartIntent,
} from "@/lib/workspace/flowchart";

export { snapshotFromLiveData };

const agentJsonSchema = z.object({
  assistantMessage: z.string(),
  ops: z.array(z.unknown()).default([]),
});

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const text = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Model did not return JSON ops");
  }
}

function sanitizeGenUiProps(props: Record<string, unknown>) {
  const candidates = [
    props.response,
    props.openui,
    props.code,
    props.lang,
    props.ui,
  ];
  const response = candidates.find(
    (v): v is string => typeof v === "string" && Boolean(v.trim()),
  );
  if (!response) {
    throw new Error("genui widget missing props.response");
  }
  const { normalized } = assertValidGenUi(response);
  return { ...props, response: normalized };
}

const AI_CREATE_TYPES = new Set(["genui", "note", "flowchart"]);

/** Map legacy native adds → genui OpenUI (or keep note/flowchart). */
function coerceLegacyAddToAllowed(
  type: string,
  title: string,
  props: Record<string, unknown>,
): { type: string; props: Record<string, unknown> } | null {
  if (AI_CREATE_TYPES.has(type)) {
    return { type, props };
  }

  if (type === "metric") {
    const value = String(props.value ?? "—");
    const unit = props.unit != null ? String(props.unit) : "";
    const display = unit && !value.includes(unit) ? `${value}${unit}` : value;
    return {
      type: "genui",
      props: {
        response: [
          `root = Stack([t, v])`,
          `t = TextContent(${JSON.stringify(title)}, "small")`,
          `v = TextContent(${JSON.stringify(display)}, "large-heavy")`,
        ].join("\n"),
      },
    };
  }

  if (type === "chart") {
    const series = Array.isArray(props.series)
      ? props.series
          .map((n) =>
            typeof n === "number"
              ? n
              : typeof n === "string" && Number.isFinite(Number(n))
                ? Number(n)
                : null,
          )
          .filter((n): n is number => n != null)
      : [];
    if (series.length === 0) return null;
    let labels = Array.isArray(props.labels) ? props.labels.map(String) : [];
    if (labels.length !== series.length) {
      labels = series.map((_, i) => labels[i] || `P${i + 1}`);
    }
    const kindRaw = String(props.kind ?? props.variant ?? "bar").toLowerCase();
    const useLine = kindRaw === "line" || kindRaw === "area";
    const chartFn = useLine ? "LineChart" : "BarChart";
    const variant = useLine ? '"natural"' : '"grouped"';
    return {
      type: "genui",
      props: {
        response: [
          `root = Stack([heading, chart])`,
          `heading = TextContent(${JSON.stringify(title)}, "large-heavy")`,
          `labels = ${JSON.stringify(labels)}`,
          `vals = ${JSON.stringify(series)}`,
          `s1 = Series("Series", vals)`,
          `chart = ${chartFn}(labels, [s1], ${variant})`,
        ].join("\n"),
      },
    };
  }

  if (type === "feed" && Array.isArray(props.items)) {
    const items = props.items.slice(0, 12);
    const lines = items.map((item, i) => {
      const row = item as { title?: unknown; meta?: unknown };
      const text =
        typeof row.title === "string"
          ? row.meta
            ? `${row.title} — ${String(row.meta)}`
            : row.title
          : String(item);
      return `item${i} = TextContent(${JSON.stringify(text)}, "small")`;
    });
    const kids = items.map((_, i) => `item${i}`).join(", ");
    return {
      type: "genui",
      props: {
        response: [
          `root = Stack([heading, ${kids}], "column", "s")`,
          `heading = TextContent(${JSON.stringify(title)}, "large-heavy")`,
          ...lines,
        ].join("\n"),
      },
    };
  }

  if (type === "kanban" && Array.isArray(props.columns)) {
    const cols = props.columns as Array<{
      title?: string;
      name?: string;
      cards?: unknown[];
    }>;
    const colExprs: string[] = [];
    const colIds: string[] = [];
    cols.forEach((col, i) => {
      const colTitle = col.title ?? col.name ?? `Column ${i + 1}`;
      const cards = (col.cards ?? []).map((c) =>
        typeof c === "string"
          ? c
          : c && typeof c === "object"
            ? String(
                (c as { title?: string }).title ||
                  (c as { name?: string }).name ||
                  "Card",
              )
            : "Card",
      );
      const cardIds = cards.map((_, j) => `c${i}_${j}`);
      cards.forEach((text, j) => {
        colExprs.push(
          `${cardIds[j]} = TextContent(${JSON.stringify(text)}, "small")`,
        );
      });
      const head = `h${i}`;
      colExprs.push(
        `${head} = TextContent(${JSON.stringify(colTitle)}, "large-heavy")`,
      );
      const stackId = `col${i}`;
      colExprs.push(
        `${stackId} = Stack([${head}${cardIds.length ? `, ${cardIds.join(", ")}` : ""}], "column", "xs")`,
      );
      colIds.push(stackId);
    });
    return {
      type: "genui",
      props: {
        response: [
          `root = Stack([${colIds.join(", ")}], "row", "m", "start", "start")`,
          ...colExprs,
        ].join("\n"),
      },
    };
  }

  // calendar / unknown — no safe conversion
  return null;
}

function resolveTargetId(
  rawId: string | undefined,
  rawName: string | undefined,
  snapshot: WorkspaceSnapshot,
): string | null {
  if (rawId) {
    const byId = snapshot.widgets.find((w) => w.id === rawId);
    if (byId) return byId.id;
  }
  if (rawName) {
    const slug = slugifyName(rawName);
    const byName = snapshot.widgets.find(
      (w) =>
        slugifyName(w.name) === slug ||
        slugifyName(w.title) === slug ||
        slugifyName(w.id) === slug,
    );
    if (byName) return byName.id;
  }
  return rawId ?? null;
}

function prepareOps(
  snapshot: WorkspaceSnapshot,
  rawOps: unknown[],
): WorkspaceOp[] {
  const base = normalizeSnapshot(snapshot);
  const takenNames = new Set(base.widgets.map((w) => slugifyName(w.name)));
  const prepared: WorkspaceOp[] = [];
  let layoutCursor = base.widgets.length;

  for (const raw of rawOps) {
    if (!raw || typeof raw !== "object") continue;
    const op = raw as Record<string, unknown>;
    const kind = op.op;

    if (kind === "add_widget" && op.widget && typeof op.widget === "object") {
      const w = op.widget as Record<string, unknown>;
      const type = typeof w.type === "string" ? w.type : "genui";
      let title =
        typeof w.title === "string" && w.title.trim()
          ? w.title.trim()
          : typeof w.name === "string"
            ? w.name
            : "Widget";
      let desiredName =
        typeof w.name === "string" && w.name.trim() ? w.name : title;
      // Models often paste the whole prompt into name/title — compress.
      if (
        slugifyName(desiredName).length > 28 ||
        slugifyName(desiredName).split("-").length > 5 ||
        title.length > 48
      ) {
        const identity = suggestWidgetIdentity(
          `${title} ${desiredName} ${typeof w.type === "string" ? w.type : ""}`,
          typeof w.type === "string" ? w.type : "genui",
        );
        desiredName = identity.name;
        if (title.length > 48) title = identity.title;
      }
      const name = allocateName(desiredName, takenNames);
      takenNames.add(name);
      const id =
        typeof w.id === "string" && w.id.trim()
          ? w.id.trim()
          : newWidgetId(name.slice(0, 12));

      let props =
        w.props && typeof w.props === "object"
          ? ({ ...(w.props as Record<string, unknown>) } as Record<
              string,
              unknown
            >)
          : {};

      let resolvedType = type;
      const coerced = coerceLegacyAddToAllowed(resolvedType, title, props);
      if (!coerced) {
        console.warn(
          `Skipping add_widget type "${type}" — use genui|note|flowchart`,
        );
        continue;
      }
      resolvedType = coerced.type;
      props = coerced.props;

      if (resolvedType === "genui") {
        try {
          props = sanitizeGenUiProps(props);
        } catch (err) {
          console.warn("Skipping invalid genui add_widget:", err);
          continue;
        }
      }

      const preferLarge = base.widgets.length === 0 && layoutCursor === 0;
      const frame =
        w.frame && typeof w.frame === "object"
          ? (w.frame as WorkspaceWidget["frame"])
          : nextWidgetFrame(
              [
                ...base.widgets,
                ...prepared
                  .filter((p) => p.op === "add_widget")
                  .map((p) => (p as { widget: WorkspaceWidget }).widget),
              ],
              preferLarge && layoutCursor === 0,
            );
      layoutCursor += 1;

      const widget = {
        id,
        type: resolvedType,
        name,
        title,
        frame,
        props,
      };
      const parsed = workspaceOpSchema.safeParse({
        op: "add_widget",
        widget,
      });
      if (parsed.success) prepared.push(parsed.data);
      continue;
    }

    if (kind === "update_widget") {
      const id = resolveTargetId(
        typeof op.id === "string" ? op.id : undefined,
        typeof op.name === "string" ? op.name : undefined,
        base,
      );
      if (!id) continue;
      const existing = base.widgets.find((w) => w.id === id);
      let props =
        op.props && typeof op.props === "object"
          ? ({ ...(op.props as Record<string, unknown>) } as Record<
              string,
              unknown
            >)
          : undefined;
      const nextType =
        typeof op.type === "string"
          ? op.type
          : existing?.type;
      if (props && (nextType === "genui" || existing?.type === "genui")) {
        if (
          typeof props.response === "string" ||
          typeof props.openui === "string" ||
          typeof props.code === "string"
        ) {
          try {
            props = sanitizeGenUiProps({
              ...existing?.props,
              ...props,
            });
          } catch (err) {
            console.warn("Skipping invalid genui update_widget:", err);
            continue;
          }
        }
      }
      let name =
        typeof op.name === "string" && op.name.trim()
          ? slugifyName(op.name)
          : undefined;
      if (name) {
        const others = new Set(
          [...takenNames].filter((n) => n !== slugifyName(existing?.name ?? "")),
        );
        name = allocateName(name, others);
        takenNames.add(name);
      }
      const parsed = workspaceOpSchema.safeParse({
        op: "update_widget",
        id,
        name,
        title: typeof op.title === "string" ? op.title : undefined,
        type: typeof op.type === "string" ? op.type : undefined,
        props,
      });
      if (parsed.success) prepared.push(parsed.data);
      continue;
    }

    if (kind === "remove_widget" || kind === "move_widget") {
      const id = resolveTargetId(
        typeof op.id === "string" ? op.id : undefined,
        typeof op.name === "string" ? op.name : undefined,
        base,
      );
      if (!id) continue;
      const parsed = workspaceOpSchema.safeParse({ ...op, id });
      if (parsed.success) prepared.push(parsed.data);
      continue;
    }

    if (kind === "set_layout") {
      // Avoid accidental full wipes unless explicitly structured.
      const parsed = workspaceOpSchema.safeParse(op);
      if (parsed.success) prepared.push(parsed.data);
    }
  }

  return prepared;
}

async function generateOpsFromPrompt(input: {
  userMessage: string;
  snapshot: WorkspaceSnapshot;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  liveData?: LiveDataBundle | null;
}) {
  const snapshot = normalizeSnapshot(input.snapshot);
  const catalog = buildWidgetCatalog(snapshot);
  const mentions = parseMentions(input.userMessage, snapshot.widgets);

  const liveExtra = input.liveData
    ? `LIVE DATA from Trigger.dev → ClickHouse (use ONLY these facts; do not invent numbers):\n${JSON.stringify(input.liveData.dashboard)}`
    : "";

  const openUiGuide = buildGenUiSystemPrompt(liveExtra);

  const system = `You are EvoDeck, an AI canvas OS. You mutate a workspace of named widgets via JSON ops.

Return ONLY a JSON object (no markdown) with shape:
{
  "assistantMessage": "short confirmation",
  "ops": [ /* workspace ops */ ]
}

Ops:
- {"op":"add_widget","widget":{"id":"optional","name":"slug","title":"Label","type":"genui|note|flowchart","frame":{"x":0-1,"y":0-1,"w":0-1,"h":0-1,"z":number},"props":{...}}}
- {"op":"update_widget","id":"...","name":"optional-rename","title":"...","props":{...}}
- {"op":"move_widget","id":"...","frame":{"x":..,"y":..,"w":..,"h":..,"z":..}}
- {"op":"remove_widget","id":"..."}

## Allowed widget types (STRICT)
- **genui** (DEFAULT) — props.response = openui-lang with root = Stack(...). Use for charts, tables, forms, checklists, dashboards, kanban-like boards, calendars, feeds, KPIs — anything OpenUI can express (LineChart, BarChart, AreaChart, PieChart, Table, Form, Tabs, Card, Steps, CheckBoxGroup, …).
- **note** — props: { body } — plain text only.
- **flowchart** — props: { nodes:[{id,label,kind}], edges:[{from,to,label?}] } — ONLY for freeform decision graphs (OpenUI has Steps, not node/edge graphs).
- Do NOT create type chart, metric, kanban, calendar, or feed. Those are legacy. Express them with genui + OpenUI instead.

## Visual flexibility (CRITICAL)
- Match the user's ask with OpenUI components: "line chart" → LineChart; "bar/column" → BarChart; "pie/donut" → PieChart; "area" → AreaChart; boards → Cards/Stacks; lists → Table or TextContent stacks.
- NEVER invent live prices, weather, FX, or news numbers. If LIVE DATA is provided below, use ONLY those facts. If the user asks for prices/weather and no live data is present, say you need a live fetch — do not fabricate series like BTC 64200.
- Example LineChart when live series is provided:
  labels = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
  vals = [/* ONLY values from LIVE DATA */]
  s1 = Series("BTC", vals)
  chart = LineChart(labels, [s1], "natural")
  root = Stack([chart])

## Mentions & editing
- Every widget has a short slug \`name\` for @mentions. NEVER paste the full user prompt into name/title.
- \`title\` is a short human label (2–5 words).
- Prefer ADDING widgets. Do NOT remove unrelated widgets or wipe the canvas unless asked.
- When the user @mentions a widget, UPDATE it — for genui, replace props.response with new OpenUI.
- Delete / move / resize / rename → matching op.
- Multiple add_widget ops OK for distinct pieces.
- Frames are 0–1; omit frame on add to auto-place.
- Keep assistantMessage brief.

OpenUI language reference (for genui props.response):
${openUiGuide}
`;

  const raw = await chatComplete({
    temperature: 0.2,
    json: true,
    messages: [
      { role: "system", content: system },
      ...input.history.slice(-6).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      {
        role: "user",
        content: [
          `Canvas widgets (catalog): ${JSON.stringify(catalog)}`,
          mentions.length
            ? `Mentioned targets: ${JSON.stringify(
                mentions.map((m) => ({
                  id: m.id,
                  name: m.name,
                  title: m.title,
                  type: m.type,
                })),
              )}`
            : "Mentioned targets: none (create new widget(s) unless updating by clear reference).",
          input.liveData
            ? `Pipeline: ${input.liveData.detail} (via ${input.liveData.via})`
            : "",
          `User request: ${input.userMessage}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const parsed = agentJsonSchema.parse(extractJsonObject(raw));
  const ops = prepareOps(snapshot, parsed.ops);
  if (ops.length === 0) {
    throw new Error("No valid canvas ops from model");
  }

  return {
    assistantMessage: parsed.assistantMessage || "Updated the canvas.",
    nextSnapshot: applyOps(snapshot, ops),
    source: "ops" as const,
    ops,
  };
}

/** Fallback / primary: freeform OpenUI GenUI card. */
async function generateSingleGenUiFallback(input: {
  userMessage: string;
  snapshot: WorkspaceSnapshot;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  liveData?: LiveDataBundle | null;
}) {
  const snapshot = normalizeSnapshot(input.snapshot);
  const mentions = parseMentions(input.userMessage, snapshot.widgets);
  const target = mentions[0];

  const liveExtra = input.liveData
    ? `LIVE DATA from Trigger.dev → ClickHouse (use ONLY these facts; do not invent numbers):\n${JSON.stringify(input.liveData.dashboard)}`
    : "";
  const system = `${buildGenUiSystemPrompt(liveExtra)}

## EvoDeck routing
- Pick the best OpenUI chart/control for the request (LineChart, BarChart, AreaChart, PieChart, Table, Form, etc.).
- For price/BTC/trends use LineChart or AreaChart — not BarChart unless asked.
- NEVER invent prices, weather, or FX. Use LIVE DATA only when provided.
- When UPDATING a checklist/todo: keep every existing CheckBoxItem, set defaultChecked true/false for the items the user named (4th arg). Do not drop items. Example: milk = CheckBoxItem("Milk", "", "milk", true)
- Output ONLY openui-lang. First statement must be root = Stack(...).`;

  const raw = await chatComplete({
    temperature: 0.3,
    messages: [
      { role: "system", content: system },
      ...input.history.slice(-4).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      {
        role: "user",
        content: [
          target
            ? `Update existing widget @${target.name} (${target.type}). Current OpenUI:\n${typeof target.props.response === "string" ? target.props.response : "(none — create fresh OpenUI)"}`
            : "Create interactive OpenUI for this request. Use the richest appropriate components:",
          input.userMessage,
        ].join("\n"),
      },
    ],
  });

  const { normalized } = assertValidGenUi(raw);

  if (target) {
    return {
      assistantMessage: `Updated @${target.name}.`,
      nextSnapshot: applyOps(snapshot, [
        {
          op: "update_widget",
          id: target.id,
          // Promote native stubs to genui when rewriting visuals
          type: "genui",
          // Clear uiState so defaultChecked / new OpenUI isn't overridden by stale bindings
          props: { response: normalized, uiState: null },
        },
      ]),
      source: "openui-genui" as const,
      openUi: normalized,
    };
  }

  const identity = suggestWidgetIdentity(input.userMessage, "genui");
  const name = allocateName(
    identity.name,
    new Set(snapshot.widgets.map((w) => w.name)),
  );
  const widget: WorkspaceWidget = {
    id: newWidgetId(name.slice(0, 12)),
    type: "genui",
    name,
    title: identity.title,
    frame: nextWidgetFrame(snapshot.widgets, snapshot.widgets.length === 0),
    props: { response: normalized },
  };

  return {
    assistantMessage: `Added @${name}.`,
    nextSnapshot: applyOps(snapshot, [{ op: "add_widget", widget }]),
    source: "openui-genui" as const,
    openUi: normalized,
  };
}

/** True when the user is asking for rich visuals OpenUI should own. */
function isOpenUiVisualIntent(message: string) {
  if (isFlowchartIntent(message)) return false;
  return /\b(line\s*chart|bar\s*chart|area\s*chart|pie\s*chart|donut|radar|scatter|horizontal\s*bar|sparkline|chart|graph|plot|dashboard|table|form|signup|sign-?up|checklist|todo|tabs?|accordion|carousel|kpi\s*card|ui|widget|visuali[sz]e)\b/i.test(
    message,
  );
}

/**
 * Multi-widget canvas agent: add / update / move / remove by @name.
 * Prefers OpenUI genui for flexible visuals; native types for simple primitives.
 */
export async function generateWorkspaceOps(input: {
  userMessage: string;
  snapshot: WorkspaceSnapshot;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  liveData?: LiveDataBundle | null;
}) {
  const mentions = parseMentions(
    input.userMessage,
    normalizeSnapshot(input.snapshot).widgets,
  );

  // Deterministic checklist check/uncheck — avoids stale uiState / LLM rewrite misses
  const checklistFix = tryChecklistMentionEdit(
    input.userMessage,
    input.snapshot,
    mentions,
  );
  if (checklistFix) return checklistFix;

  // Native chart label tweak only — don't block OpenUI upgrades
  const chartFix = tryEnsureChartLabels(input.userMessage, input.snapshot);
  if (chartFix) return chartFix;

  // @mention on an existing genui → prefer OpenUI rewrite (before broad "visual" create path)
  if (mentions.some((m) => m.type === "genui")) {
    try {
      return await generateSingleGenUiFallback(input);
    } catch (genUiError) {
      console.warn("OpenUI update path failed, trying ops agent:", genUiError);
    }
  }

  // New visual requests → OpenUI GenUI first (max flexibility)
  if (isOpenUiVisualIntent(input.userMessage)) {
    try {
      return await generateSingleGenUiFallback(input);
    } catch (genUiError) {
      console.warn("OpenUI visual path failed, trying ops agent:", genUiError);
    }
  }

  // Decision flowcharts (node/edge graph) — native layout; OpenUI has Steps but not freeform graphs
  if (isFlowchartIntent(input.userMessage)) {
    try {
      return await generateFlowchartWidget(input);
    } catch (flowchartError) {
      console.warn("Flowchart path failed, trying ops agent:", flowchartError);
    }
  }

  try {
    return await generateOpsFromPrompt(input);
  } catch (opsError) {
    console.warn("Ops agent failed, trying GenUI fallback:", opsError);
    try {
      return await generateSingleGenUiFallback(input);
    } catch (genUiError) {
      console.warn("Freeform OpenUI GenUI failed:", genUiError);

      if (input.liveData && input.liveData.dashboard.feed.length > 0) {
        return {
          assistantMessage: `Pulled live signals via ${input.liveData.via} into ClickHouse and laid out the desk.`,
          nextSnapshot: snapshotFromLiveData(input.snapshot, input.liveData),
          source: "live-deterministic" as const,
        };
      }

      return {
        assistantMessage:
          "I couldn't compose the canvas cleanly — try rephrasing, or mention a widget with @name.",
        nextSnapshot: applyOps(normalizeSnapshot(input.snapshot), [
          {
            op: "add_widget",
            widget: {
              id: newWidgetId("note"),
              type: "note",
              name: allocateName(
                "try-again",
                new Set(input.snapshot.widgets.map((w) => w.name || w.id)),
              ),
              title: "Try again",
              frame: nextWidgetFrame(input.snapshot.widgets),
              props: {
                body: "Generative UI failed to parse. Ask again, or @mention a widget to tweak it.",
              },
            },
          },
        ]),
        source: "fallback-note" as const,
      };
    }
  }
}

/** @mention + check/mark done → rewrite CheckBoxItem defaults + sync uiState bindings. */
function tryChecklistMentionEdit(
  userMessage: string,
  snapshot: WorkspaceSnapshot,
  mentions: WorkspaceWidget[],
) {
  const intent = detectChecklistEditIntent(userMessage);
  if (!intent) return null;

  const base = normalizeSnapshot(snapshot);
  const target =
    mentions.find((m) => widgetHasChecklist(m)) ??
    (mentions[0]?.type === "genui" ? mentions[0] : null);
  if (!target || !widgetHasChecklist(target)) return null;

  const response =
    typeof target.props.response === "string" ? target.props.response : "";
  const edited = applyChecklistEditToOpenUi(response, intent);
  if (!edited) return null;

  const verb = intent.action === "check" ? "Checked" : "Unchecked";
  return {
    assistantMessage: `${verb} ${edited.matched.join(", ")} on @${target.name}.`,
    nextSnapshot: applyOps(base, [
      {
        op: "update_widget",
        id: target.id,
        props: {
          response: edited.response,
          uiState: edited.uiState,
        },
      },
    ]),
    source: "checklist-edit" as const,
  };
}

/** @mention a chart + ask for numbers/labels → update props instead of no-op / new widget. */
function tryEnsureChartLabels(
  userMessage: string,
  snapshot: WorkspaceSnapshot,
) {
  const base = normalizeSnapshot(snapshot);
  const mentions = parseMentions(userMessage, base.widgets);
  const chart =
    mentions.find((w) => w.type === "chart") ??
    (mentions[0]?.type === "chart" ? mentions[0] : null);
  if (!chart) return null;

  const wantsLabels =
    /\b(label|labels|number|numbers|value|values|axis|show\s+(the\s+)?(numbers|values|labels)|add\s+(numbers|labels|values)|with\s+labels)\b/i.test(
      userMessage,
    );
  if (!wantsLabels) return null;

  const series = Array.isArray(chart.props.series)
    ? chart.props.series
        .map((n) =>
          typeof n === "number"
            ? n
            : typeof n === "string" && Number.isFinite(Number(n))
              ? Number(n)
              : null,
        )
        .filter((n): n is number => n != null)
    : [];
  if (series.length === 0) return null;

  const existing = Array.isArray(chart.props.labels)
    ? chart.props.labels.map(String)
    : [];
  const labels =
    existing.length === series.length
      ? existing
      : series.map((_, i) => existing[i] || `P${i + 1}`);

  return {
    assistantMessage: `Updated @${chart.name} with value labels.`,
    nextSnapshot: applyOps(base, [
      {
        op: "update_widget",
        id: chart.id,
        props: {
          series,
          labels,
          kind: chart.props.kind ?? chart.props.variant ?? "bar",
        },
      },
    ]),
    source: "chart-labels" as const,
  };
}

async function generateFlowchartWidget(input: {
  userMessage: string;
  snapshot: WorkspaceSnapshot;
}) {
  const snapshot = normalizeSnapshot(input.snapshot);
  const mentions = parseMentions(input.userMessage, snapshot.widgets);
  const target =
    mentions.find((m) => m.type === "flowchart") ??
    (mentions[0]?.type === "flowchart" ? mentions[0] : null);

  const heuristic = heuristicFruitEveningFlow(input.userMessage);
  const parsed =
    heuristic ??
    (await generateFlowchartJson({
      userMessage: input.userMessage,
      complete: async (messages) =>
        chatComplete({
          temperature: 0.2,
          json: true,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
    }));

  if (target) {
    return {
      assistantMessage:
        parsed.assistantMessage || `Updated @${target.name}.`,
      nextSnapshot: applyOps(snapshot, [
        {
          op: "update_widget",
          id: target.id,
          title: parsed.title || target.title,
          props: {
            nodes: parsed.nodes,
            edges: parsed.edges,
          },
        },
      ]),
      source: "flowchart-json" as const,
    };
  }

  const identity = suggestWidgetIdentity(input.userMessage, "flowchart");
  const name = allocateName(
    identity.name,
    new Set(snapshot.widgets.map((w) => w.name)),
  );
  const widget: WorkspaceWidget = {
    id: newWidgetId("flow"),
    type: "flowchart",
    name,
    title: parsed.title || identity.title,
    frame: nextWidgetFrame(snapshot.widgets, snapshot.widgets.length === 0),
    props: {
      nodes: parsed.nodes,
      edges: parsed.edges,
    },
  };

  return {
    assistantMessage: parsed.assistantMessage || `Added @${name}.`,
    nextSnapshot: applyOps(snapshot, [{ op: "add_widget", widget }]),
    source: "flowchart-json" as const,
  };
}

export async function proposeWidgetsWithTools(input: {
  userMessage: string;
  snapshot: WorkspaceSnapshot;
}) {
  const { runAgentFetchTools, dashboardFromToolResults } = await import(
    "@/lib/workspace/agent-tools"
  );
  const tools = await runAgentFetchTools({ userMessage: input.userMessage });
  const toolDash = dashboardFromToolResults(tools.results);

  let liveData: LiveDataBundle | null = null;
  if (tools.results.some((r) => r.ok)) {
    liveData = {
      intent: { kind: "fetch", topic: input.userMessage.slice(0, 200) },
      dashboard: {
        sources: toolDash.sources,
        feed: toolDash.feed,
        metrics: toolDash.metrics,
        chart: toolDash.chart,
        eventCount: toolDash.eventCount,
      },
      via: "tools",
      detail: tools.detail,
    };
  }

  const result = await generateWorkspaceOps({
    userMessage: input.userMessage,
    snapshot: input.snapshot,
    history: [],
    liveData,
  });
  return {
    ...result,
    toolCalls: tools.results.map((r) => ({
      name: r.name,
      ok: r.ok,
      error: r.error,
    })),
  };
}
