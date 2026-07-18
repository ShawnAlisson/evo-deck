"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceWidget } from "@/lib/workspace/snapshot";
import { slugifyName } from "@/lib/workspace/naming";

export type ComposeMode = "ai" | "note";

export function MentionComposer({
  value,
  onChange,
  onSubmit,
  onClose,
  mode,
  onModeChange,
  widgets,
  disabled,
  busy,
  busyLabel,
  canEdit,
  inputRef,
  listening,
  onToggleMic,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onClose?: () => void;
  mode: ComposeMode;
  onModeChange: (mode: ComposeMode) => void;
  widgets: WorkspaceWidget[];
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  canEdit: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  listening?: boolean;
  onToggleMic?: () => void;
}) {
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const modeRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [menuOpen, setMenuOpen] = useState(true);
  const [modeOpen, setModeOpen] = useState(false);

  useEffect(() => {
    if (!modeOpen) return;
    const onDown = (e: PointerEvent) => {
      if (modeRef.current?.contains(e.target as Node)) return;
      setModeOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [modeOpen]);

  const mentionQuery = useMemo(() => {
    if (mode !== "ai") return null;
    const caret = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/@([a-z0-9-]*)$/i);
    if (!match) return null;
    return { query: match[1] ?? "", start: caret - match[0].length };
  }, [value, ref, mode]);

  const suggestions = useMemo(() => {
    if (!menuOpen || !mentionQuery) return [];
    const q = slugifyName(mentionQuery.query);
    return widgets
      .filter((w) => {
        const name = slugifyName(w.name);
        const title = slugifyName(w.title);
        if (!q) return true;
        return name.includes(q) || title.includes(q);
      })
      .slice(0, 6);
  }, [mentionQuery, widgets, menuOpen]);

  function insertMention(widget: WorkspaceWidget) {
    if (!mentionQuery) return;
    const caret = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, mentionQuery.start);
    const after = value.slice(caret);
    const next = `${before}@${widget.name} ${after}`;
    setMenuOpen(false);
    setActive(0);
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const pos = before.length + widget.name.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="prompt-dock">
      <div className="prompt-mode" ref={modeRef}>
        <button
          type="button"
          className="prompt-mode-btn"
          aria-haspopup="listbox"
          aria-expanded={modeOpen}
          aria-label={mode === "ai" ? "Mode: AI" : "Mode: Note"}
          title={mode === "ai" ? "AI" : "Note"}
          disabled={disabled}
          onClick={() => setModeOpen((o) => !o)}
        >
          {mode === "ai" ? <AiModeIcon /> : <NoteModeIcon />}
          <span aria-hidden>▾</span>
        </button>
        {modeOpen ? (
          <ul className="prompt-mode-menu" role="listbox">
            <li>
              <button
                type="button"
                role="option"
                aria-selected={mode === "ai"}
                className={mode === "ai" ? "is-active" : ""}
                onClick={() => {
                  onModeChange("ai");
                  setModeOpen(false);
                }}
              >
                <AiModeIcon />
                <span>AI</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                role="option"
                aria-selected={mode === "note"}
                className={mode === "note" ? "is-active" : ""}
                onClick={() => {
                  onModeChange("note");
                  setModeOpen(false);
                }}
              >
                <NoteModeIcon />
                <span>Note</span>
              </button>
            </li>
          </ul>
        ) : null}
      </div>

      <div className="mention-composer">
        {suggestions.length > 0 ? (
          <ul className="mention-menu" role="listbox">
            {suggestions.map((w, i) => (
              <li key={w.id}>
                <button
                  type="button"
                  className={i === active ? "is-active" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(w);
                  }}
                >
                  <strong>@{w.name}</strong>
                  <span>{w.title !== w.name ? w.title : w.type}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="floating-input"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input
            ref={ref}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setMenuOpen(true);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (!suggestions.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((n) => Math.min(suggestions.length - 1, n + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((n) => Math.max(0, n - 1));
              } else if (e.key === "Enter" && mentionQuery) {
                e.preventDefault();
                const pick = suggestions[active];
                if (pick) insertMention(pick);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setMenuOpen(false);
              }
            }}
            placeholder={
              !canEdit
                ? "View only"
                : mode === "note"
                  ? "Write a note to drop on the canvas…"
                  : "Describe the canvas… or @mention a widget"
            }
            disabled={disabled}
          />
          <button type="submit" disabled={disabled || !value.trim()}>
            {busy ? busyLabel || "…" : mode === "note" ? "Add" : "Send"}
          </button>
        </form>
      </div>

      {(onToggleMic || onClose) ? (
        <div className="prompt-side-actions">
          {onToggleMic ? (
            <button
              type="button"
              className={`prompt-side-btn${listening ? " is-hot" : ""}`}
              aria-label={listening ? "Stop listening" : "Start voice input"}
              aria-pressed={listening}
              title={listening ? "Stop" : "Speak"}
              disabled={disabled && !listening}
              onClick={onToggleMic}
            >
              <MicIcon listening={Boolean(listening)} />
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="prompt-side-btn"
              aria-label="Close"
              title="Close"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MicIcon({ listening }: { listening: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        fill={listening ? "currentColor" : "none"}
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AiModeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3l1.4 4.2L18 8.6l-4.2 1.4L12 14l-1.4-4.2L6 8.6l4.2-1.4L12 3z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 14.5l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NoteModeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 4h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M14 4v4h4M9 12h6M9 16h6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
