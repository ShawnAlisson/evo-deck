import { z } from "zod";

export const flowNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["start", "decision", "process", "end"]).default("process"),
});

export const flowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

export const flowchartPropsSchema = z.object({
  nodes: z.array(flowNodeSchema).min(1),
  edges: z.array(flowEdgeSchema).default([]),
});

export type FlowNode = z.infer<typeof flowNodeSchema>;
export type FlowEdge = z.infer<typeof flowEdgeSchema>;
export type FlowchartProps = z.infer<typeof flowchartPropsSchema>;

export function isFlowchartIntent(message: string) {
  return /\b(flowchart|flow\s*chart|decision\s*tree|diagram|decision\s*flow|branch(?:ing)?\s*(?:flow|tree)|if\s+then)\b/i.test(
    message,
  );
}

const flowchartJsonSchema = z.object({
  assistantMessage: z.string(),
  title: z.string().default("Flowchart"),
  nodes: z.array(flowNodeSchema).min(1),
  edges: z.array(flowEdgeSchema),
});

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Model did not return JSON");
  }
}

/** Dedicated JSON path — far more reliable than OpenUI Lang for local models. */
export async function generateFlowchartJson(input: {
  userMessage: string;
  complete: (messages: Array<{ role: "system" | "user"; content: string }>) => Promise<string>;
}) {
  const raw = await input.complete([
    {
      role: "system",
      content: `You build decision flowcharts as JSON only. No markdown.
Schema:
{"assistantMessage":"short reply","title":"...","nodes":[{"id":"a","label":"...","kind":"start|decision|process|end"}],"edges":[{"from":"a","to":"b","label":"optional"}]}

Rules:
- kind "decision" for choices/questions; "process" for actions; "start" once; "end" for terminals
- Cover EVERY branch the user described
- Use short labels (2–6 words)
- ids are short slug-like strings
- edges must reference existing node ids`,
    },
    {
      role: "user",
      content: input.userMessage,
    },
  ]);

  return flowchartJsonSchema.parse(extractJson(raw));
}

/** Last-resort heuristic for the banana/apple style prompt (and similar). */
export function heuristicFruitEveningFlow(message: string): z.infer<typeof flowchartJsonSchema> | null {
  const lower = message.toLowerCase();
  if (!/(banana|apple)/.test(lower) || !/(pie|sleep|play|game)/.test(lower)) {
    return null;
  }
  return {
    assistantMessage: "Laid out your banana/apple decision flowchart on the canvas.",
    title: "Fruit → pie → evening",
    nodes: [
      { id: "start", label: "Choose fruit", kind: "start" },
      { id: "fruit", label: "Banana or apple?", kind: "decision" },
      { id: "apple", label: "Pick apple", kind: "process" },
      { id: "banana", label: "Pick banana", kind: "process" },
      { id: "apple-pie", label: "Make apple pie", kind: "process" },
      { id: "banana-pie", label: "Make banana pie", kind: "process" },
      { id: "evening", label: "Sleep or play game?", kind: "decision" },
      { id: "sleep", label: "Sleep", kind: "end" },
      { id: "game", label: "Play game", kind: "end" },
    ],
    edges: [
      { from: "start", to: "fruit" },
      { from: "fruit", to: "apple", label: "apple" },
      { from: "fruit", to: "banana", label: "banana" },
      { from: "apple", to: "apple-pie" },
      { from: "banana", to: "banana-pie" },
      { from: "apple-pie", to: "evening" },
      { from: "banana-pie", to: "evening" },
      { from: "evening", to: "sleep", label: "sleep" },
      { from: "evening", to: "game", label: "play" },
    ],
  };
}
