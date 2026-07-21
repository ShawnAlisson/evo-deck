import { chat } from "@trigger.dev/sdk/ai";
import { z } from "zod";
import { chatComplete, type ChatMessage } from "@/lib/llm";

/**
 * Durable Trigger.dev chat agent for the EvoDeck conversational surface.
 *
 * The main canvas route still owns workspace-specific authorization, live-data
 * intent handling, and revision commits. This agent provides the durable
 * Trigger chat/session path for conversations that need resumable turns.
 */
export const evodeckChatAgent = chat.agent({
  id: "evodeck-chat-agent",
  clientDataSchema: z.object({
    workspaceId: z.string().uuid().optional(),
    branchId: z.string().uuid().nullable().optional(),
  }),
  idleTimeoutInSeconds: 60,
  run: async ({ messages, signal }) => {
    const modelMessages: ChatMessage[] = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role,
        content:
          typeof message.content === "string"
            ? message.content
            : message.content
                .map((part) => (part.type === "text" ? part.text : ""))
                .join(""),
      }))
      .filter((message) => message.content.trim().length > 0);

    if (modelMessages.length === 0) return;

    const answer = await chatComplete({
      messages: modelMessages,
      temperature: 0.2,
    });

    if (signal.aborted) return;

    const id = `evodeck-${Date.now()}`;
    chat.response.write({ type: "text-start", id });

    // Emit small deltas so the Trigger chat transport receives a genuine
    // streamed response even though EvoDeck's provider adapter returns text.
    for (let offset = 0; offset < answer.length; offset += 48) {
      if (signal.aborted) return;
      const delta = answer.slice(offset, offset + 48);
      chat.response.write({ type: "text-delta", id, delta });
    }

    chat.response.write({ type: "text-end", id });
  },
});
