import { readFileSync } from "fs";
import { join } from "path";
import { createParser } from "@openuidev/lang-core";

/**
 * Server-safe GenUI helpers.
 * Do NOT import openuiLibrary from `@openuidev/react-ui` in API routes —
 * Next can strip Library methods. Schema/prompt are generated from genui-lib.
 */

const schemaPath = join(process.cwd(), "lib/openui/generated/openui-schema.json");
const promptPath = join(process.cwd(), "lib/openui/generated/openui-prompt.txt");

let parser: ReturnType<typeof createParser> | null = null;
let basePrompt: string | null = null;

function getParser() {
  if (!parser) {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    parser = createParser(schema, "Stack");
  }
  return parser;
}

function getBasePrompt() {
  if (!basePrompt) {
    basePrompt = readFileSync(promptPath, "utf8");
  }
  return basePrompt;
}

const ECHOES_INTERACTION_RULES = `## Echoes interaction rules
- Prefer the richest OpenUI components that match the ask (LineChart / BarChart / AreaChart / PieChart / Table / Form / Tabs / Accordion / Steps / Card). Do not default to plain TextContent.
- Price, BTC, stocks, trends over time → LineChart or AreaChart with Series(...). Category comparisons → BarChart. Shares/composition → PieChart.
- NEVER invent live prices, weather, FX rates, or news scores. If LIVE DATA is in context, use ONLY those numbers. Otherwise keep charts illustrative with clearly labeled sample data or ask for a live fetch.
- When the user asks for checkmarks, checklists, todos, shopping lists, or multi-select items: use CheckBoxGroup + CheckBoxItem (or SwitchGroup). Never fake checks with emoji (✅) or static TextContent.
- To mark an item done on an existing list: keep all CheckBoxItems and set the 4th arg defaultChecked to true for that item only, e.g. milk = CheckBoxItem("Milk", "", "milk", true)
- Prefer real interactive controls (CheckBoxGroup, Form fields, Buttons with Action, Tabs, Accordion) over decorative text.
- Stack takes at most 6 positional args: children, direction?, gap?, align?, justify?, wrap?. Put ALL children in the first array arg — never pass siblings as extra Stack args.
- To let users add checklist items: Form + Input bound to $newTodo + Button Action([@ToAssistant("Add to-do: " + $newTodo)]). Bind the Input value: Input("newTodo", "e.g. Milk", "text", { required: true, minLength: 2 }, $newTodo). Do NOT rely on unbound $vars in Action strings.
- Example checklist:
  apple = CheckBoxItem("Apple", "", "apple")
  orange = CheckBoxItem("Orange", "", "orange")
  banana = CheckBoxItem("Banana", "", "banana")
  fruits = CheckBoxGroup("fruits", [apple, orange, banana])
  root = Stack([fruits])
- Example line chart:
  labels = ["Mon", "Tue", "Wed", "Thu", "Fri"]
  vals = [100, 120, 115, 140, 138]
  s1 = Series("Price", vals)
  chart = LineChart(labels, [s1], "natural")
  root = Stack([chart])`;

/** Full OpenUI component library prompt — any visual UI, not a fixed widget enum. */
export function buildGenUiSystemPrompt(extra?: string) {
  const base = getBasePrompt();
  const parts = [base, ECHOES_INTERACTION_RULES];
  if (extra?.trim()) parts.push(`## Echoes context\n${extra.trim()}`);
  return parts.join("\n\n");
}

export function normalizeGenUiResponse(text: string): string {
  let raw = text.trim();
  const fenced = raw.match(/```(?:openui|lang)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) raw = fenced[1].trim();
  const lines = raw.split("\n");
  const start = lines.findIndex((line) => /^\s*(?:root|\$?\w+)\s*=/.test(line));
  if (start > 0) raw = lines.slice(start).join("\n").trim();
  return raw;
}

export function assertValidGenUi(text: string) {
  const normalized = normalizeGenUiResponse(text);
  const result = getParser().parse(normalized);
  if (!result.root || result.root.typeName !== "Stack") {
    const errors = result.meta?.errors ?? [];
    throw new Error(
      `OpenUI GenUI missing Stack root${errors.length ? `: ${JSON.stringify(errors).slice(0, 300)}` : ""}`,
    );
  }
  return { normalized, parseResult: result };
}
