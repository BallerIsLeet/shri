// chat_design_character — multi-turn helper for designing a character via chat.
//
// Loads existing chatJson (history of {role, content} turns), appends the new
// user message, asks aiClient.chat.complete with a focused system prompt to
// either ask a refining question OR propose a finalized description string.
// Persists the appended turns to Character.chatJson and returns the assistant
// reply + optional suggestedDescription.
//
// See docs/14-characters.md "Chat mode".

import { z } from "zod";
import { aiClient } from "@shri/ai";
import type { ChatMessage } from "@shri/ai";
import { Prisma, prisma } from "@shri/db";
import type { ToolContext } from "./descriptors.js";

export type { ToolContext };

const ChatTurn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export const inputSchema = z.object({
  characterId: z.string().min(1),
  message: z.string().min(1, "message is required"),
  // Optional override; otherwise we read existing chatJson from the row.
  priorTurns: z.array(ChatTurn).optional(),
});
export type ChatDesignCharacterInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  reply: z.string(),
  suggestedDescription: z.string().nullable(),
  turns: z.array(ChatTurn),
});
export type ChatDesignCharacterOutput = z.infer<typeof outputSchema>;

export const SYSTEM_PROMPT = [
  "You are a creative director helping the user design a character for marketing content.",
  "Your job over the turn-by-turn conversation:",
  " 1. Ask focused questions about visual style, species/type, age vibe, posture, props, palette, and personality.",
  " 2. When you have enough detail (usually 3–6 turns), propose a final 2–4 sentence canonical description and ask for confirmation.",
  "",
  "OUTPUT FORMAT: respond with strict JSON, no other text:",
  '  { "reply": string, "suggestedDescription": string | null }',
  "  - `reply` is the natural-language chat response to the user (your question, or your proposal + ask for confirmation).",
  "  - `suggestedDescription` is null if you're still gathering info, OR the canonical 2–4 sentence visual description string once you have enough to propose one.",
  "Always emit JSON.",
].join("\n");

type ChatTurnT = z.infer<typeof ChatTurn>;

// Exported for unit tests.
export function parseAssistantJson(raw: string): {
  reply: string;
  suggestedDescription: string | null;
} {
  const trimmed = raw.trim();
  // Try direct parse first, then fall back to extracting the first JSON object.
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) {
      throw new Error(
        `chat_design_character: assistant returned non-JSON: ${trimmed.slice(0, 200)}`,
      );
    }
    parsed = JSON.parse(m[0]);
  }
  const shape = z
    .object({
      reply: z.string().min(1),
      suggestedDescription: z.string().nullable().default(null),
    })
    .safeParse(parsed);
  if (!shape.success) {
    throw new Error(
      `chat_design_character: assistant JSON missing required fields: ${shape.error.message}`,
    );
  }
  return {
    reply: shape.data.reply,
    suggestedDescription: shape.data.suggestedDescription ?? null,
  };
}

function turnsFromJson(value: unknown): ChatTurnT[] {
  if (!Array.isArray(value)) return [];
  const out: ChatTurnT[] = [];
  for (const t of value) {
    const ok = ChatTurn.safeParse(t);
    if (ok.success) out.push(ok.data);
  }
  return out;
}

export async function chatDesignCharacter(
  rawInput: ChatDesignCharacterInput,
  ctx: ToolContext,
): Promise<ChatDesignCharacterOutput> {
  const input = inputSchema.parse(rawInput);

  const character = await prisma.character.findUnique({
    where: { id: input.characterId },
  });
  if (!character) {
    throw new Error(
      `chat_design_character: character ${input.characterId} not found`,
    );
  }
  if (character.projectId !== ctx.projectId) {
    throw new Error(
      `chat_design_character: character ${input.characterId} does not belong to project ${ctx.projectId}`,
    );
  }

  const prior =
    input.priorTurns && input.priorTurns.length > 0
      ? input.priorTurns
      : turnsFromJson(character.chatJson);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...prior.map(
      (t): ChatMessage => ({
        role: t.role,
        content: t.content,
      }),
    ),
    { role: "user", content: input.message },
  ];

  const res = await aiClient.chat.complete({
    messages,
    temperature: 0.7,
    maxTokens: 600,
    responseFormat: "json",
  });

  const { reply, suggestedDescription } = parseAssistantJson(res.message.content);

  const newTurns: ChatTurnT[] = [
    ...prior,
    { role: "user", content: input.message },
    { role: "assistant", content: reply },
  ];

  await prisma.character.update({
    where: { id: character.id },
    data: {
      chatJson: newTurns as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    reply,
    suggestedDescription,
    turns: newTurns,
  };
}

// Convention alias — descriptors.ts wraps a tool by its `handler` export.
export const handler = chatDesignCharacter;
