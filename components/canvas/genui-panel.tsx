"use client";

import { Renderer } from "@openuidev/react-lang";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import "@openuidev/react-ui/components.css";
import "@openuidev/react-ui/styles/index.css";

/** Parser soft-warnings that still render fine (excess args are dropped). */
const BENIGN_CODES = new Set(["excess-args", "missing-args", "unknown-prop"]);

function isBenignOpenUiError(error: unknown): boolean {
  if (error == null) return true;
  if (Array.isArray(error)) {
    if (error.length === 0) return true;
    return error.every(isBenignOpenUiError);
  }
  if (typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && BENIGN_CODES.has(code)) return true;
  }
  return false;
}

export function GenUiPanel({
  response,
  initialState,
  onStateUpdate,
}: {
  response: string;
  initialState?: Record<string, unknown>;
  onStateUpdate?: (state: Record<string, unknown>) => void;
}) {
  return (
    <div className="echo-genui">
      <div className="echo-genui-body">
        <Renderer
          response={response}
          library={openuiLibrary}
          initialState={initialState}
          onStateUpdate={onStateUpdate}
          onError={(error) => {
            if (isBenignOpenUiError(error)) return;
            console.error("OpenUI render error:", error);
          }}
        />
      </div>
    </div>
  );
}
