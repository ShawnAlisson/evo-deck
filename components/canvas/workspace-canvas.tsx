"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  WorkspaceSnapshot,
  WorkspaceWidget,
} from "@/lib/workspace/snapshot";
import { allocateName, slugifyName } from "@/lib/workspace/naming";
import { WidgetCard } from "./widget-card";
import { WidgetEditor } from "./widget-editor";

type DragMode = "move" | "resize" | null;

type ContextMenuState = {
  widgetId: string;
  x: number;
  y: number;
};

/** Don't steal pointerdown from OpenUI controls (checkboxes, inputs, tabs, etc.). */
function isInteractivePointerTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      [
        "a",
        "button",
        "input",
        "textarea",
        "select",
        "label",
        "option",
        "[role='button']",
        "[role='checkbox']",
        "[role='switch']",
        "[role='radio']",
        "[role='slider']",
        "[role='textbox']",
        "[role='combobox']",
        "[role='listbox']",
        "[role='option']",
        "[role='menuitem']",
        "[role='tab']",
        "[contenteditable='true']",
        "[data-no-drag]",
      ].join(","),
    ),
  );
}

export function WorkspaceCanvas({
  snapshot,
  interactive,
  onCommit,
  onSelectedChange,
}: {
  snapshot: WorkspaceSnapshot;
  interactive: boolean;
  onCommit: (
    next: WorkspaceSnapshot,
    meta?: { label?: string },
  ) => void | Promise<void>;
  onSelectedChange?: (widget: WorkspaceWidget | null) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkspaceSnapshot | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const uiStateTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const dragRef = useRef<{
    mode: DragMode;
    id: string;
    startX: number;
    startY: number;
    origin: WorkspaceWidget;
  } | null>(null);

  const view = draft ?? snapshot;

  const sorted = useMemo(
    () => [...view.widgets].sort((a, b) => a.frame.z - b.frame.z),
    [view.widgets],
  );

  const editingWidget = editingId
    ? (view.widgets.find((w) => w.id === editingId) ?? null)
    : null;

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, closeMenu]);

  useEffect(() => {
    const timers = uiStateTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (selectedId && !view.widgets.some((w) => w.id === selectedId)) {
      setSelectedId(null);
    }
  }, [view.widgets, selectedId]);

  useEffect(() => {
    const widget = selectedId
      ? (view.widgets.find((w) => w.id === selectedId) ?? null)
      : null;
    onSelectedChange?.(widget);
  }, [selectedId, view.widgets, onSelectedChange]);

  useEffect(() => {
    if (!interactive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editingId || menu) return;
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactive, editingId, menu]);

  const commitWidgets = useCallback(
    (widgets: WorkspaceWidget[], label: string) => {
      setDraft(null);
      closeMenu();
      onCommit({ version: 1, widgets }, { label });
    },
    [closeMenu, onCommit],
  );

  const patchWidget = useCallback(
    (
      widgetId: string,
      patch: Partial<Pick<WorkspaceWidget, "name" | "title" | "props">>,
      label: string,
    ) => {
      if (!interactive) return;
      const taken = new Set(
        view.widgets
          .filter((w) => w.id !== widgetId)
          .map((w) => slugifyName(w.name)),
      );
      commitWidgets(
        view.widgets.map((w) => {
          if (w.id !== widgetId) return w;
          const name = patch.name ? allocateName(patch.name, taken) : w.name;
          return {
            ...w,
            name,
            title: patch.title ?? w.title,
            props: patch.props ? { ...w.props, ...patch.props } : w.props,
          };
        }),
        label,
      );
    },
    [commitWidgets, interactive, view.widgets],
  );

  const deleteWidget = useCallback(
    (widgetId: string) => {
      if (!interactive) return;
      const target = view.widgets.find((w) => w.id === widgetId);
      commitWidgets(
        view.widgets.filter((w) => w.id !== widgetId),
        target ? `Deleted @${target.name}` : "Deleted widget",
      );
      setSelectedId((id) => (id === widgetId ? null : id));
      setEditingId((id) => (id === widgetId ? null : id));
    },
    [commitWidgets, interactive, view.widgets],
  );

  const bringToFront = useCallback(
    (widgetId: string) => {
      if (!interactive) return;
      const maxZ = Math.max(0, ...view.widgets.map((w) => w.frame.z));
      commitWidgets(
        view.widgets.map((w) =>
          w.id === widgetId ? { ...w, frame: { ...w.frame, z: maxZ + 1 } } : w,
        ),
        "Brought to front",
      );
    },
    [commitWidgets, interactive, view.widgets],
  );

  const sendToBack = useCallback(
    (widgetId: string) => {
      if (!interactive) return;
      const minZ = Math.min(...view.widgets.map((w) => w.frame.z), 1);
      commitWidgets(
        view.widgets.map((w) =>
          w.id === widgetId ? { ...w, frame: { ...w.frame, z: minZ - 1 } } : w,
        ),
        "Sent to back",
      );
    },
    [commitWidgets, interactive, view.widgets],
  );

  const scheduleUiState = useCallback(
    (widgetId: string, state: Record<string, unknown>) => {
      if (!interactive) return;
      const existing = uiStateTimers.current.get(widgetId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        uiStateTimers.current.delete(widgetId);
        const base = draft ?? snapshot;
        const nextWidgets = base.widgets.map((w) =>
          w.id === widgetId
            ? { ...w, props: { ...w.props, uiState: state } }
            : w,
        );
        setDraft({ version: 1, widgets: nextWidgets });
        void onCommit(
          { version: 1, widgets: nextWidgets },
          { label: "Widget interaction" },
        );
      }, 450);
      uiStateTimers.current.set(widgetId, timer);
    },
    [draft, interactive, onCommit, snapshot],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      const board = boardRef.current;
      if (!drag || !board) return;
      const rect = board.getBoundingClientRect();
      const dx = (e.clientX - drag.startX) / rect.width;
      const dy = (e.clientY - drag.startY) / rect.height;
      setDraft((prev) => {
        const base = prev ?? snapshot;
        return {
          version: 1,
          widgets: base.widgets.map((w) => {
            if (w.id !== drag.id) return w;
            if (drag.mode === "move") {
              return {
                ...w,
                frame: {
                  ...w.frame,
                  x: clamp(drag.origin.frame.x + dx, 0, 1 - w.frame.w),
                  y: clamp(drag.origin.frame.y + dy, 0, 1 - w.frame.h),
                },
              };
            }
            return {
              ...w,
              frame: {
                ...w.frame,
                w: clamp(drag.origin.frame.w + dx, 0.08, 1 - w.frame.x),
                h: clamp(drag.origin.frame.h + dy, 0.08, 1 - w.frame.y),
              },
            };
          }),
        };
      });
    },
    [snapshot],
  );

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    if (!drag) return;

    setDraft((current) => {
      if (!current) return null;
      void Promise.resolve(onCommit(current));
      return current;
    });
  }, [onCommit, onPointerMove]);

  useEffect(() => {
    if (!draft) return;
    const matched = draft.widgets.every((w) => {
      const s = snapshot.widgets.find((x) => x.id === w.id);
      if (!s) return false;
      return (
        approx(s.frame.x, w.frame.x) &&
        approx(s.frame.y, w.frame.y) &&
        approx(s.frame.w, w.frame.w) &&
        approx(s.frame.h, w.frame.h) &&
        approx(s.frame.z, w.frame.z)
      );
    });
    if (matched && draft.widgets.length === snapshot.widgets.length) {
      setDraft(null);
    }
  }, [snapshot, draft]);

  const startDrag = (
    e: React.PointerEvent,
    widget: WorkspaceWidget,
    mode: DragMode,
  ) => {
    if (!interactive || !mode) return;
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    setSelectedId(widget.id);
    dragRef.current = {
      mode,
      id: widget.id,
      startX: e.clientX,
      startY: e.clientY,
      origin: widget,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  return (
    <div
      className="echo-canvas"
      ref={boardRef}
      onPointerDown={(e) => {
        if (!interactive) return;
        if (e.button !== 0) return;
        const target = e.target as Element | null;
        if (
          target?.closest(
            ".echo-widget-shell, .echo-context-menu, .echo-editor-backdrop, .echo-editor",
          )
        ) {
          return;
        }
        setSelectedId(null);
        closeMenu();
      }}
    >
      <div className="echo-canvas-grid" />
      {sorted.map((widget) => (
        <div
          key={widget.id}
          className="echo-widget-shell"
          style={{
            left: `${widget.frame.x * 100}%`,
            top: `${widget.frame.y * 100}%`,
            width: `${widget.frame.w * 100}%`,
            height: `${widget.frame.h * 100}%`,
            zIndex: Math.round(widget.frame.z),
          }}
          onContextMenu={(e) => {
            if (!interactive) return;
            e.preventDefault();
            e.stopPropagation();
            setSelectedId(widget.id);
            const pad = 8;
            const menuW = 168;
            const menuH = 180;
            setMenu({
              widgetId: widget.id,
              x: Math.min(e.clientX, window.innerWidth - menuW - pad),
              y: Math.min(e.clientY, window.innerHeight - menuH - pad),
            });
          }}
        >
          <WidgetCard
            widget={widget}
            selected={selectedId === widget.id}
            onUiState={(state) => scheduleUiState(widget.id, state)}
            onPointerDown={(e) => {
              if (e.button === 2) return;
              // Always select on click, even when hitting interactive GenUI controls
              setSelectedId(widget.id);
              const target = e.target as HTMLElement;
              if (target.closest("[data-resize]")) {
                startDrag(e, widget, "resize");
                return;
              }
              if (target.closest("[data-drag-handle], .echo-widget-head")) {
                startDrag(e, widget, "move");
                return;
              }
              if (isInteractivePointerTarget(target)) return;
              startDrag(e, widget, "move");
            }}
          />
        </div>
      ))}
      {sorted.length === 0 ? (
        <div className="echo-empty">
          <p className="echo-brand">Echoes</p>
          <p>Describe the workspace you want.</p>
          <p className="echo-empty-hint">Mention widgets later with @name</p>
        </div>
      ) : null}

      {menu && interactive ? (
        <div
          ref={menuRef}
          className="echo-context-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            className="echo-context-menu-item"
            onClick={() => {
              setEditingId(menu.widgetId);
              closeMenu();
            }}
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="echo-context-menu-item"
            onClick={() => bringToFront(menu.widgetId)}
          >
            Bring to front
          </button>
          <button
            type="button"
            role="menuitem"
            className="echo-context-menu-item"
            onClick={() => sendToBack(menu.widgetId)}
          >
            Send to back
          </button>
          <button
            type="button"
            role="menuitem"
            className="echo-context-menu-item is-danger"
            onClick={() => deleteWidget(menu.widgetId)}
          >
            Delete
          </button>
        </div>
      ) : null}

      {editingWidget && interactive ? (
        <WidgetEditor
          widget={editingWidget}
          onClose={() => setEditingId(null)}
          onSave={(patch) => {
            patchWidget(editingWidget.id, patch, `Edited @${patch.name}`);
            setEditingId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function approx(a: number, b: number) {
  return Math.abs(a - b) < 0.0015;
}
