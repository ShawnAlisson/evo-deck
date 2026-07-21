"use server";

import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";

/** Start or resume a durable Trigger.dev EvoDeck chat session. */
export const startEvoDeckChatSession =
  chat.createStartSessionAction("evodeck-chat-agent");

/** Mint a short-lived, session-scoped token for the Trigger chat transport. */
export async function mintEvoDeckChatAccessToken(chatId: string) {
  return auth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  });
}
