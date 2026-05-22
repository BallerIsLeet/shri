// generateTts — text-to-speech via aiClient.tts (CLAUDE.md convention #1)
// uploaded to R2 under keys.outputVoice. Returns the R2 key + a presigned read
// URL so the caller (orchestrator) can immediately hand it to muxAudio.
//
// Used by REEL voiceover mode (docs/04 mode C). Never imports `openai`
// directly — only aiClient.tts.speak.

import { z } from "zod";
import { aiClient } from "@shri/ai";
import { keys, putObject, signedReadUrl } from "@shri/storage";
import type { ToolContext } from "./descriptors.js";

export const inputSchema = z.object({
  projectSlug: z.string().min(1),
  itemId: z.string().min(1),
  text: z.string().min(1),
  // Optional override of the env-configured default voice (OPENAI_TTS_VOICE).
  voice: z.string().optional(),
  // We default to mp3 because that's what ffmpeg + downstream players expect.
  format: z.enum(["mp3", "wav"]).default("mp3"),
});

export type ToolInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  r2Key: z.string(),
  url: z.string(),
  durationS: z.number(),
  costUsd: z.number(),
});

export type ToolOutput = z.infer<typeof outputSchema>;

export async function handler(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutput> {
  const input = inputSchema.parse(rawInput);

  // Orchestrator handles logging; ctx travels for future use.
  void ctx;

  const res = await aiClient.tts.speak({
    text: input.text,
    voice: input.voice,
    format: input.format,
  });

  const key = keys.outputVoice(input.projectSlug, input.itemId);
  const contentType = input.format === "mp3" ? "audio/mpeg" : "audio/wav";
  await putObject(key, res.buffer, contentType);

  // 1h TTL — same as Seedance refs. Long enough for downstream mux, short
  // enough not to leak.
  const url = await signedReadUrl(key, 3600);

  return {
    r2Key: key,
    url,
    durationS: res.durationS,
    costUsd: res.usage.costUsd,
  };
}
