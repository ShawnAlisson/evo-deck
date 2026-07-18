import type { ActionEvent } from "@openuidev/react-lang";

type FormField = { name: string; value: string };

/** Pull string-ish field values out of OpenUI formState snapshots. */
export function extractFormFields(
  formState: Record<string, unknown> | undefined,
): FormField[] {
  if (!formState) return [];
  const out: FormField[] = [];

  for (const [key, raw] of Object.entries(formState)) {
    if (key.startsWith("$")) continue;
    if (raw && typeof raw === "object" && "value" in raw) {
      const v = (raw as { value: unknown }).value;
      if (v !== undefined && v !== null && v !== "") {
        out.push({ name: key, value: String(v) });
      }
      continue;
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [field, nested] of Object.entries(
        raw as Record<string, unknown>,
      )) {
        if (nested && typeof nested === "object" && "value" in nested) {
          const v = (nested as { value: unknown }).value;
          if (v !== undefined && v !== null && v !== "") {
            out.push({ name: field, value: String(v) });
          }
        }
      }
    }
  }
  return out;
}

/**
 * Turn a GenUI ActionEvent into a chat message for /api/chat.
 * Returns null when the host should not send chat (e.g. OpenUrl handled).
 */
export function chatMessageFromAction(
  event: ActionEvent,
  widgetMention: string,
): string | null {
  if (event.type === "open_url") {
    const url = event.params?.url;
    if (typeof url === "string" && url && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return null;
  }

  if (event.type !== "continue_conversation") return null;

  let msg = (event.humanFriendlyMessage || "").trim();
  const fields = extractFormFields(event.formState);

  // `$newTodo` in Action strings often isn't bound — splice form values in.
  if (fields.length > 0) {
    const primary = fields[0]!.value;
    const broken =
      !msg ||
      /:\s*$/.test(msg) ||
      /\bundefined\b|\bnull\b/i.test(msg) ||
      !fields.some((f) => msg.includes(f.value));

    if (broken) {
      msg = msg
        .replace(/\bundefined\b|\bnull\b/gi, "")
        .replace(/:\s*$/, "")
        .trim();
      if (/add/i.test(msg) || !msg) {
        msg = msg ? `${msg}: ${primary}` : primary;
      } else {
        const summary = fields.map((f) => `${f.name}: ${f.value}`).join(", ");
        msg = msg ? `${msg} (${summary})` : summary;
      }
    }
  }

  if (!msg) return null;

  const mention = widgetMention.startsWith("@")
    ? widgetMention
    : `@${widgetMention}`;
  if (!msg.toLowerCase().includes(mention.toLowerCase())) {
    msg = `${mention} ${msg}`;
  }
  return msg;
}
