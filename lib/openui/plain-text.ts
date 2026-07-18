/**
 * Notes render as plain text. Models often emit LaTeX/markdown that looks broken
 * on the canvas ($\\sin$, \\frac, **bold**, etc.). Normalize to readable prose.
 */
export function sanitizePlainText(input: string): string {
  let text = input;

  // $...$ and $$...$$ math → inner content
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, "$1");
  text = text.replace(/\$([^$]+)\$/g, "$1");

  // Common LaTeX commands (unwrap \\text before \\frac so nested braces work)
  text = text.replace(/\\text\s*\{([^{}]*)\}/g, "$1");
  text = text.replace(/\\mathrm\s*\{([^{}]*)\}/g, "$1");
  text = text.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1 / $2");
  text = text.replace(/\\dfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1 / $2");

  const symbols: Record<string, string> = {
    "\\theta": "θ",
    "\\phi": "φ",
    "\\pi": "π",
    "\\alpha": "α",
    "\\beta": "β",
    "\\gamma": "γ",
    "\\delta": "δ",
    "\\omega": "ω",
    "\\infty": "∞",
    "\\pm": "±",
    "\\times": "×",
    "\\cdot": "·",
    "\\leq": "≤",
    "\\le": "≤",
    "\\geq": "≥",
    "\\ge": "≥",
    "\\neq": "≠",
    "\\approx": "≈",
    "\\sin": "sin",
    "\\cos": "cos",
    "\\tan": "tan",
    "\\log": "log",
    "\\ln": "ln",
    "\\sqrt": "√",
  };
  for (const [from, to] of Object.entries(symbols)) {
    text = text.split(from).join(to);
  }

  // Leftover {\...} or bare backslash commands
  text = text.replace(/\\([a-zA-Z]+)/g, "$1");
  text = text.replace(/[{}]/g, "");

  // Light markdown → plain
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/__([^_]+)__/g, "$1");
  text = text.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "$1");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/`([^`]+)`/g, "$1");

  // Collapse noisy whitespace but keep paragraph breaks
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]{2,}/g, " ");

  return text.trim();
}
