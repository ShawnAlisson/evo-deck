"use client";

import { useEffect, useState } from "react";
import type { WorkspaceWidget } from "@/lib/workspace/snapshot";
import { slugifyName } from "@/lib/workspace/naming";

export function WidgetEditor({
  widget,
  onSave,
  onClose,
}: {
  widget: WorkspaceWidget;
  onSave: (patch: {
    name: string;
    title: string;
    props: Record<string, unknown>;
  }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(widget.name);
  const [title, setTitle] = useState(widget.title);
  const [body, setBody] = useState(String(widget.props.body ?? ""));
  const [value, setValue] = useState(String(widget.props.value ?? ""));
  const [unit, setUnit] = useState(String(widget.props.unit ?? ""));
  const [response, setResponse] = useState(String(widget.props.response ?? ""));
  const [dataJson, setDataJson] = useState(() => formatWidgetData(widget));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const props = { ...widget.props };
    if (widget.type === "note") props.body = body;
    if (widget.type === "metric") {
      props.value = value;
      props.unit = unit;
    }
    if (widget.type === "genui") props.response = response;
    if (widget.type === "chart" || widget.type === "flowchart") {
      try {
        const parsed = JSON.parse(dataJson) as Record<string, unknown>;
        if (widget.type === "chart") {
          if (!Array.isArray(parsed.series)) {
            throw new Error("chart source needs a series number array");
          }
          props.series = parsed.series;
          if (parsed.labels != null) props.labels = parsed.labels;
          if (parsed.kind != null) props.kind = parsed.kind;
        } else {
          if (!Array.isArray(parsed.nodes)) {
            throw new Error("flowchart source needs a nodes array");
          }
          props.nodes = parsed.nodes;
          props.edges = Array.isArray(parsed.edges) ? parsed.edges : [];
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid JSON source");
        return;
      }
    }
    onSave({
      name: slugifyName(name || title || widget.id),
      title: title.trim() || name || widget.id,
      props,
    });
  }

  const sourceLabel =
    widget.type === "genui"
      ? "OpenUI source"
      : widget.type === "chart"
        ? "Chart data (JSON)"
        : widget.type === "flowchart"
          ? "Flowchart data (JSON)"
          : null;

  return (
    <div className="echo-editor-backdrop" role="presentation" onClick={onClose}>
      <form
        className="echo-editor"
        role="dialog"
        aria-label="Edit widget"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <header className="echo-editor-head">
          <strong>Edit widget</strong>
          <button type="button" className="echo-editor-close" onClick={onClose}>
            ×
          </button>
        </header>

        <label className="echo-editor-field">
          <span>Mention name</span>
          <div className="echo-editor-mention">
            <em>@</em>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="fruit-list"
              autoComplete="off"
            />
          </div>
        </label>

        <label className="echo-editor-field">
          <span>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Display title"
          />
        </label>

        {widget.type === "note" ? (
          <label className="echo-editor-field">
            <span>Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
            />
          </label>
        ) : null}

        {widget.type === "metric" ? (
          <div className="echo-editor-row">
            <label className="echo-editor-field">
              <span>Value</span>
              <input value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
            <label className="echo-editor-field">
              <span>Unit</span>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
          </div>
        ) : null}

        {widget.type === "genui" ? (
          <label className="echo-editor-field">
            <span>{sourceLabel}</span>
            <textarea
              className="echo-editor-code"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={12}
              spellCheck={false}
            />
          </label>
        ) : null}

        {widget.type === "chart" || widget.type === "flowchart" ? (
          <label className="echo-editor-field">
            <span>{sourceLabel}</span>
            <textarea
              className="echo-editor-code"
              value={dataJson}
              onChange={(e) => setDataJson(e.target.value)}
              rows={12}
              spellCheck={false}
            />
          </label>
        ) : null}

        {widget.type !== "note" &&
        widget.type !== "metric" &&
        widget.type !== "genui" &&
        widget.type !== "chart" &&
        widget.type !== "flowchart" ? (
          <p className="echo-editor-hint">
            You can rename this widget. For deeper content changes, mention{" "}
            <code>@{widget.name}</code> in chat.
          </p>
        ) : null}

        {error ? <p className="echo-editor-hint">{error}</p> : null}

        <footer className="echo-editor-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="is-primary">
            Save
          </button>
        </footer>
      </form>
    </div>
  );
}

function formatWidgetData(widget: WorkspaceWidget) {
  if (widget.type === "chart") {
    return JSON.stringify(
      {
        kind: widget.props.kind ?? "bar",
        series: widget.props.series ?? [],
        labels: widget.props.labels ?? [],
      },
      null,
      2,
    );
  }
  if (widget.type === "flowchart") {
    return JSON.stringify(
      {
        nodes: widget.props.nodes ?? [],
        edges: widget.props.edges ?? [],
      },
      null,
      2,
    );
  }
  return "";
}
