import { z } from "zod";
import { allocateName } from "@/lib/workspace/naming";

export const widgetTypeSchema = z.enum([
  // Legacy (still rendered if present on old canvases; AI no longer creates these)
  "chart",
  "kanban",
  "calendar",
  "feed",
  "metric",
  "clock",
  // Active create types
  "note",
  "flowchart",
  "genui",
]);

export const frameSchema = z.object({
  x: z.number().transform((n) => clamp01(n)),
  y: z.number().transform((n) => clamp01(n)),
  w: z
    .number()
    .transform((n) => Math.min(1, Math.max(0.05, n))),
  h: z
    .number()
    .transform((n) => Math.min(1, Math.max(0.05, n))),
  z: z.number(),
});

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export const widgetSchema = z.object({
  id: z.string().min(1),
  type: widgetTypeSchema,
  /** Short @mention handle (slug). */
  // Empty names exist in older snapshots; normalizeSnapshot assigns a stable
  // mentionable name when the snapshot is loaded or persisted.
  name: z.string().optional().default(""),
  title: z.string(),
  frame: frameSchema,
  props: z.record(z.string(), z.unknown()).default({}),
});

export const workspaceSnapshotSchema = z.object({
  version: z.literal(1),
  widgets: z.array(widgetSchema),
});

export type WidgetType = z.infer<typeof widgetTypeSchema>;
export type WidgetFrame = z.infer<typeof frameSchema>;
export type WorkspaceWidget = z.infer<typeof widgetSchema>;
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;

export const workspaceOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_widget"),
    widget: widgetSchema,
  }),
  z.object({
    op: z.literal("update_widget"),
    id: z.string(),
    name: z.string().optional(),
    title: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    type: widgetTypeSchema.optional(),
  }),
  z.object({
    op: z.literal("move_widget"),
    id: z.string(),
    frame: frameSchema.partial(),
  }),
  z.object({
    op: z.literal("remove_widget"),
    id: z.string(),
  }),
  z.object({
    op: z.literal("set_layout"),
    widgets: z.array(widgetSchema),
  }),
]);

export const workspaceOpsResponseSchema = z.object({
  assistantMessage: z.string(),
  ops: z.array(workspaceOpSchema),
});

export type WorkspaceOp = z.infer<typeof workspaceOpSchema>;
export type WorkspaceOpsResponse = z.infer<typeof workspaceOpsResponseSchema>;

export function emptySnapshot(): WorkspaceSnapshot {
  return { version: 1, widgets: [] };
}

/** Ensure every widget has a unique mentionable `name` (back-compat for old revisions). */
export function normalizeSnapshot(
  snapshot: WorkspaceSnapshot,
): WorkspaceSnapshot {
  const taken = new Set<string>();
  const widgets = snapshot.widgets.map((w) => {
    const name = allocateName(w.name || w.title || w.id, taken);
    taken.add(name);
    return { ...w, name, title: w.title || name };
  });
  return { version: 1, widgets };
}

export function applyOps(
  snapshot: WorkspaceSnapshot,
  ops: WorkspaceOp[],
): WorkspaceSnapshot {
  let widgets = [...normalizeSnapshot(snapshot).widgets];

  for (const op of ops) {
    switch (op.op) {
      case "add_widget": {
        widgets = widgets.filter((w) => w.id !== op.widget.id);
        widgets.push(op.widget);
        break;
      }
      case "update_widget": {
        widgets = widgets.map((w) =>
          w.id === op.id
            ? {
                ...w,
                name: op.name ?? w.name,
                title: op.title ?? w.title,
                type: op.type ?? w.type,
                props: op.props ? { ...w.props, ...op.props } : w.props,
              }
            : w,
        );
        break;
      }
      case "move_widget": {
        widgets = widgets.map((w) =>
          w.id === op.id
            ? {
                ...w,
                frame: {
                  ...w.frame,
                  ...op.frame,
                },
              }
            : w,
        );
        break;
      }
      case "remove_widget": {
        widgets = widgets.filter((w) => w.id !== op.id);
        break;
      }
      case "set_layout": {
        widgets = [...op.widgets];
        break;
      }
    }
  }

  return normalizeSnapshot(
    workspaceSnapshotSchema.parse({ version: 1, widgets }),
  );
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function lerpSnapshots(
  from: WorkspaceSnapshot,
  to: WorkspaceSnapshot,
  t: number,
): WorkspaceSnapshot {
  const clamped = Math.min(1, Math.max(0, t));
  const toById = new Map(to.widgets.map((w) => [w.id, w]));
  const fromById = new Map(from.widgets.map((w) => [w.id, w]));
  const ids = new Set([...fromById.keys(), ...toById.keys()]);

  const widgets: WorkspaceWidget[] = [];
  for (const id of ids) {
    const a = fromById.get(id);
    const b = toById.get(id);
    if (a && b) {
      widgets.push({
        ...b,
        name: clamped < 0.5 ? a.name : b.name,
        title: clamped < 0.5 ? a.title : b.title,
        props: clamped < 0.5 ? a.props : b.props,
        type: clamped < 0.5 ? a.type : b.type,
        frame: {
          x: lerp(a.frame.x, b.frame.x, clamped),
          y: lerp(a.frame.y, b.frame.y, clamped),
          w: lerp(a.frame.w, b.frame.w, clamped),
          h: lerp(a.frame.h, b.frame.h, clamped),
          z: lerp(a.frame.z, b.frame.z, clamped),
        },
      });
    } else if (b && clamped > 0.15) {
      widgets.push({
        ...b,
        frame: {
          ...b.frame,
          w: b.frame.w * clamped,
          h: b.frame.h * clamped,
        },
      });
    } else if (a && clamped < 0.85) {
      const fade = 1 - clamped;
      widgets.push({
        ...a,
        frame: {
          ...a.frame,
          w: a.frame.w * fade,
          h: a.frame.h * fade,
        },
      });
    }
  }

  return { version: 1, widgets };
}

export function snapshotAtPlayhead(
  revisions: Array<{ seq: number; snapshot: WorkspaceSnapshot }>,
  playhead: number,
): WorkspaceSnapshot {
  if (revisions.length === 0) return emptySnapshot();
  if (revisions.length === 1) return normalizeSnapshot(revisions[0].snapshot);

  const maxIndex = revisions.length - 1;
  const clamped = Math.min(maxIndex, Math.max(0, playhead));
  const i0 = Math.floor(clamped);
  const i1 = Math.min(maxIndex, i0 + 1);
  const t = clamped - i0;
  if (t < 0.001) return normalizeSnapshot(revisions[i0].snapshot);
  if (t > 0.999) return normalizeSnapshot(revisions[i1].snapshot);
  return normalizeSnapshot(
    lerpSnapshots(revisions[i0].snapshot, revisions[i1].snapshot, t),
  );
}
