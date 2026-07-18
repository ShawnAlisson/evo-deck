/**
 * Regenerates server-safe OpenUI prompt + JSON schema from genui-lib.
 * Usage: npm run openui:generate
 */
import { writeFileSync, mkdirSync } from "fs";
import { openuiLibrary, openuiPromptOptions } from "@openuidev/react-ui/genui-lib";

mkdirSync("./lib/openui/generated", { recursive: true });

writeFileSync(
  "./lib/openui/generated/openui-schema.json",
  JSON.stringify(openuiLibrary.toJSONSchema(), null, 2),
);

const prompt = openuiLibrary.prompt({
  ...openuiPromptOptions,
  preamble: `You are EvoDeck, a generative UI agent. Your response IS the product: visual, interactive, explorable OpenUI Lang — never a wall of text.

Rules:
- Output ONLY valid openui-lang (no markdown fences, no prose outside statements).
- Always define root = Stack(...) first.
- Prefer visual structure: Stack, Card, Steps, Table, charts, Callout, Tabs — not long paragraphs.
- For decision trees / flowcharts / branching processes: use nested Steps + Cards/Callouts (or Stacks) to show each branch clearly. Do not dump the user prompt as plain text.
- For explanations: short TextContent plus structured Cards/Steps — keep prose minimal.
- For checklists / checkmarks / todos / multi-select: use CheckBoxGroup + CheckBoxItem (never emoji ✅ or static text).
- Never invent unsafe HTML or scripts; only compose library components.`,
});

writeFileSync("./lib/openui/generated/openui-prompt.txt", prompt);
console.log("Wrote lib/openui/generated/openui-schema.json + openui-prompt.txt");
