import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

export type AiProvider = "openai" | "gemini" | "vertex";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompleteOptions = {
  messages: ChatMessage[];
  temperature?: number;
  /** Ask the model for a JSON object (OpenAI json_object / Gemini responseMimeType). */
  json?: boolean;
  model?: string;
};

function isLocalBaseUrl(baseURL?: string) {
  if (!baseURL) return false;
  try {
    const host = new URL(baseURL).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/** Active provider — switch with AI_PROVIDER=openai|gemini|vertex */
export function getAiProvider(): AiProvider {
  const raw = (process.env.AI_PROVIDER ?? "openai").trim().toLowerCase();
  if (raw === "gemini" || raw === "vertex" || raw === "openai") return raw;
  return "openai";
}

export function getAiModel(provider = getAiProvider()): string {
  if (provider === "gemini" || provider === "vertex") {
    return (
      process.env.GEMINI_MODEL?.trim() ||
      process.env.VERTEX_MODEL?.trim() ||
      "gemini-2.5-flash"
    );
  }
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function openaiConfigured() {
  const key = process.env.OPENAI_API_KEY?.trim();
  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  if (key) return true;
  return isLocalBaseUrl(baseURL);
}

function geminiConfigured() {
  return Boolean(
    process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim(),
  );
}

function vertexConfigured() {
  const project =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GCP_PROJECT?.trim();
  // Google Cloud API key and/or project (+ ADC)
  return Boolean(project || process.env.VERTEX_API_KEY?.trim());
}

/** True when the active AI_PROVIDER has enough env to call a model. */
export function isAiConfigured() {
  const provider = getAiProvider();
  if (provider === "gemini") return geminiConfigured();
  if (provider === "vertex") return vertexConfigured();
  return openaiConfigured();
}

export function getOpenAIClient() {
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const apiKey =
    process.env.OPENAI_API_KEY?.trim() ||
    (isLocalBaseUrl(baseURL) ? "local" : "");

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. For OpenRouter/OpenAI set a real key; for local models you can leave it empty if OPENAI_BASE_URL points at localhost.",
    );
  }

  return new OpenAI({
    apiKey,
    baseURL,
  });
}

/** @deprecated Prefer getAiModel() — kept for call sites that still expect OpenAI naming. */
export function getOpenAIModel() {
  return getAiModel("openai");
}

function geminiApiKey() {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
    ""
  );
}

function vertexApiKey() {
  return process.env.VERTEX_API_KEY?.trim() || "";
}

function getGoogleClient(provider: "gemini" | "vertex") {
  if (provider === "gemini") {
    const apiKey = geminiApiKey() || process.env.GOOGLE_API_KEY?.trim() || "";
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Get one from Google AI Studio, or switch AI_PROVIDER=openai|vertex.",
      );
    }
    return new GoogleGenAI({ apiKey });
  }

  const project =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.GCP_PROJECT?.trim();
  const location =
    process.env.GOOGLE_CLOUD_LOCATION?.trim() ||
    process.env.VERTEX_LOCATION?.trim() ||
    "us-central1";
  const apiKey = vertexApiKey();

  if (!project && !apiKey) {
    throw new Error(
      "For AI_PROVIDER=vertex set VERTEX_API_KEY and/or GOOGLE_CLOUD_PROJECT in .env.local.",
    );
  }

  // SDK: apiKey XOR project/location — prefer API key when present.
  if (apiKey) {
    return new GoogleGenAI({
      vertexai: true,
      apiKey,
    });
  }

  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
}

function splitSystemMessages(messages: ChatMessage[]) {
  const systemParts: string[] = [];
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> =
    [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    });
  }

  // Gemini requires contents to start with a user turn.
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Continue." }] });
  } else if (contents[0]?.role === "model") {
    contents.unshift({
      role: "user",
      parts: [{ text: "(context)" }],
    });
  }

  return {
    systemInstruction: systemParts.length ? systemParts.join("\n\n") : undefined,
    contents,
  };
}

async function chatCompleteOpenAI(opts: ChatCompleteOptions): Promise<string> {
  const client = getOpenAIClient();
  const model = opts.model ?? getAiModel("openai");
  const completion = await client.chat.completions.create({
    model,
    temperature: opts.temperature ?? 0.2,
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
    messages: opts.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });
  return completion.choices[0]?.message?.content ?? "";
}

async function chatCompleteGoogle(
  provider: "gemini" | "vertex",
  opts: ChatCompleteOptions,
): Promise<string> {
  const ai = getGoogleClient(provider);
  const model = opts.model ?? getAiModel(provider);
  const { systemInstruction, contents } = splitSystemMessages(opts.messages);

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      temperature: opts.temperature ?? 0.2,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  });

  const text = response.text?.trim() ?? "";
  if (!text) {
    throw new Error(`${provider} returned an empty response`);
  }
  return text;
}

/**
 * Provider-agnostic chat completion.
 * Switch backends with AI_PROVIDER=openai|gemini|vertex in .env.local
 */
export async function chatComplete(opts: ChatCompleteOptions): Promise<string> {
  const provider = getAiProvider();
  if (provider === "gemini" || provider === "vertex") {
    return chatCompleteGoogle(provider, opts);
  }
  return chatCompleteOpenAI(opts);
}

export function describeAiSetup() {
  const provider = getAiProvider();
  const model = getAiModel(provider);
  return { provider, model, configured: isAiConfigured() };
}
