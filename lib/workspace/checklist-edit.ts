import type { WorkspaceWidget } from "@/lib/workspace/snapshot";

export type ChecklistEditIntent = {
  action: "check" | "uncheck";
  /** Free-text item query from the user message */
  query: string;
};

/** Detect “check/mark X done” style edits on a mentioned checklist. */
export function detectChecklistEditIntent(
  message: string,
): ChecklistEditIntent | null {
  const text = message.replace(/@[a-z0-9-]+/gi, " ").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();

  const uncheck =
    lower.match(
      /\b(?:uncheck|un-check|untick|unmark|clear)\s+(.+?)(?:\s+as\s+(?:done|complete|completed|checked))?$/i,
    ) ??
    lower.match(
      /\bmark\s+(.+?)\s+(?:as\s+)?(?:unchecked|not\s+done|incomplete|todo)\b/i,
    );
  if (uncheck?.[1]) {
    return {
      action: "uncheck",
      query: cleanItemQuery(uncheck[1]),
    };
  }

  const check =
    lower.match(
      /\b(?:check(?:\s+off)?|tick|complete|finish|done)\s+(.+?)(?:\s+as\s+(?:done|complete|completed|checked))?$/i,
    ) ??
    lower.match(
      /\bmark\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|checked)\b/i,
    ) ??
    lower.match(/\b(.+?)\s+(?:is\s+)?(?:done|complete|completed|checked)\b/i);
  if (check?.[1]) {
    const q = cleanItemQuery(check[1]);
    if (q && !/^(the|a|an|it|this|that|all|everything)$/i.test(q)) {
      return { action: "check", query: q };
    }
  }

  return null;
}

function cleanItemQuery(raw: string): string {
  return raw
    .replace(
      /\b(as\s+)?(done|complete|completed|checked|please|item|task|the|a|an)\b/gi,
      " ",
    )
    .replace(/[?!.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type CheckBoxLine = {
  varName: string;
  label: string;
  description: string;
  itemName: string;
  checked: boolean;
  full: string;
  index: number;
};

/** Parse CheckBoxItem(...) statements from openui-lang. */
export function parseCheckBoxItems(response: string): CheckBoxLine[] {
  const items: CheckBoxLine[] = [];
  const re =
    /^(\w+)\s*=\s*CheckBoxItem\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*(?:,\s*(true|false))?\s*\)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(response))) {
    items.push({
      varName: m[1]!,
      label: unescapeStr(m[2]!),
      description: unescapeStr(m[3]!),
      itemName: unescapeStr(m[4]!),
      checked: m[5] === "true",
      full: m[0]!,
      index: m.index,
    });
  }
  return items;
}

function unescapeStr(s: string) {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function escapeStr(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function itemMatches(item: CheckBoxLine, query: string): boolean {
  const q = query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!q) return false;
  const hay = `${item.label} ${item.itemName} ${item.description}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  if (hay.includes(q)) return true;
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);
  if (tokens.length === 0) return hay.includes(q);
  return tokens.every((t) => hay.includes(t));
}

/** Find CheckBoxGroup name from openui-lang (for uiState key). */
export function parseCheckBoxGroupName(response: string): string | null {
  const m = response.match(
    /(\w+)\s*=\s*CheckBoxGroup\(\s*"((?:\\.|[^"\\])*)"/,
  );
  return m?.[2] ? unescapeStr(m[2]) : null;
}

/**
 * Apply check/uncheck to matching CheckBoxItems in openui-lang.
 * Returns null if no checklist items or no match.
 */
export function applyChecklistEditToOpenUi(
  response: string,
  intent: ChecklistEditIntent,
): { response: string; matched: string[]; uiState: Record<string, unknown> } | null {
  const items = parseCheckBoxItems(response);
  if (items.length === 0) return null;

  const matched = items.filter((it) => itemMatches(it, intent.query));
  if (matched.length === 0) {
    // Fallback: if only one item and query is vague ("it"/"this"), skip
    return null;
  }

  const checkedSet = new Set(
    matched.map((it) => it.itemName),
  );
  const want = intent.action === "check";

  let next = response;
  // Replace from end so indices stay valid
  const ordered = [...items].sort((a, b) => b.index - a.index);
  for (const it of ordered) {
    const nextChecked = checkedSet.has(it.itemName) ? want : it.checked;
    const replacement = `${it.varName} = CheckBoxItem("${escapeStr(it.label)}", "${escapeStr(it.description)}", "${escapeStr(it.itemName)}"${nextChecked ? ", true" : ""})`;
    next =
      next.slice(0, it.index) +
      replacement +
      next.slice(it.index + it.full.length);
  }

  // Rebuild aggregate for binding — stored state must match defaults
  const groupName = parseCheckBoxGroupName(next) ?? "todos";
  const aggregate: Record<string, boolean> = {};
  for (const it of parseCheckBoxItems(next)) {
    aggregate[it.itemName] = it.checked;
  }

  return {
    response: next,
    matched: matched.map((m) => m.label),
    uiState: { [groupName]: aggregate },
  };
}

export function widgetHasChecklist(widget: WorkspaceWidget): boolean {
  const response =
    typeof widget.props.response === "string" ? widget.props.response : "";
  return /CheckBox(?:Group|Item)\s*\(/.test(response);
}
