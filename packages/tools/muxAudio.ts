// muxAudio — ffmpeg wrapper.
//
// Two modes:
//   - combine: MP4 (silent or otherwise) + MP3 → MP4 with -c:v copy -shortest
//   - strip:   MP4 → MP4 with -an (drops audio track entirely)
//
// Runs against R2-resident sources: we download to tmp, invoke ffmpeg locally,
// upload the result. Centralizes ffmpeg-static plumbing in one place so other
// tools (concatVideos) can reuse the same pattern.
//
// No mocks. The test suite runs real ffmpeg-static against generated fixtures.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { z } from "zod";
import { keys, getObject, putObject, signedReadUrl } from "@shri/storage";
import type { ToolContext } from "./descriptors.js";

// fluent-ffmpeg expects either a string path or a function reference. Both the
// `ffmpeg-static` and `@ffmpeg-installer/ffmpeg` packages export the path as
// the default export — the type is `string | null` if not bundled for this
// platform.
function getFfmpegBinary(): string {
  const path = ffmpegStatic as unknown as string | null;
  if (!path) {
    throw new Error(
      "muxAudio: ffmpeg-static did not provide a binary for this platform. " +
        "Reinstall ffmpeg-static or set FFMPEG_PATH env var.",
    );
  }
  return process.env.FFMPEG_PATH ?? path;
}

export const inputSchema = z.object({
  projectSlug: z.string().min(1),
  itemId: z.string().min(1),
  // Source video R2 key (typically keys.outputSeedance or keys.outputFinal-stage).
  videoR2Key: z.string().min(1),
  // For mode="combine": MP3 R2 key (typically keys.outputVoice).
  audioR2Key: z.string().optional(),
  mode: z.enum(["combine", "strip"]),
});

export type ToolInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  r2Key: z.string(),
  url: z.string(),
});

export type ToolOutput = z.infer<typeof outputSchema>;

/**
 * Lower-level mux for callers that already have local file paths (the test
 * suite, and other tools running in the same temp dir). Returns the path of
 * the produced file. Caller owns cleanup.
 *
 * For mode="combine": `-c:v copy -shortest` per docs/04 — no video re-encode,
 * audio clipped to video duration so a long voiceover doesn't extend visuals.
 * For mode="strip":   `-an` — drops audio entirely.
 */
export async function muxLocal(
  videoPath: string,
  audioPath: string | undefined,
  outPath: string,
  mode: "combine" | "strip",
): Promise<void> {
  if (mode === "combine" && !audioPath) {
    throw new Error("muxLocal: mode='combine' requires an audioPath");
  }

  const bin = getFfmpegBinary();
  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg().setFfmpegPath(bin).input(videoPath);
    if (mode === "combine") {
      cmd
        .input(audioPath!)
        // Copy the video stream as-is, encode audio to AAC, stop at shortest input.
        .outputOptions(["-c:v copy", "-c:a aac", "-b:a 128k", "-shortest"]);
    } else {
      cmd.outputOptions(["-c:v copy", "-an"]);
    }
    cmd
      .on("error", (err) => reject(new Error(`ffmpeg failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(outPath);
  });
}

export async function handler(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutput> {
  const input = inputSchema.parse(rawInput);
  if (input.mode === "combine" && !input.audioR2Key) {
    throw new Error("mux_audio: mode='combine' requires audioR2Key");
  }

  // Orchestrator owns logging.
  void ctx;

  const work = await mkdtemp(join(tmpdir(), "shri-mux-"));
  try {
    const videoBuf = await getObject(input.videoR2Key);
    const videoPath = join(work, "in.mp4");
    await writeFile(videoPath, videoBuf);

    let audioPath: string | undefined;
    if (input.mode === "combine") {
      const audioBuf = await getObject(input.audioR2Key!);
      audioPath = join(work, "voice.mp3");
      await writeFile(audioPath, audioBuf);
    }

    const outPath = join(work, "out.mp4");
    await muxLocal(videoPath, audioPath, outPath, input.mode);

    const outBuf = await readFile(outPath);
    const key = keys.outputFinal(input.projectSlug, input.itemId);
    await putObject(key, outBuf, "video/mp4");
    const url = await signedReadUrl(key, 3600);
    return { r2Key: key, url };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
