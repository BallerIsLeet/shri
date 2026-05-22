// concatVideos — ffmpeg concat for multi-scene reels (docs/17).
//
// Two strategies based on transition kind:
//
//   hard_cut, match_cut  → concat demuxer, lossless. ffmpeg `-f concat` with
//                          a list.txt of inputs, `-c copy`. No re-encode.
//                          The fast path (>90% of usage per docs/17).
//
//   dissolve, fade       → xfade filter, requires re-encode. Crossfades
//                          between consecutive clips at the boundary.
//
// Per docs/17 the transitions array has length n-1 for n videos. The transition
// at index i applies between videoR2Keys[i] and videoR2Keys[i+1]. Mixed kinds
// are supported: any non-cut transition forces the xfade path for the WHOLE
// timeline (xfade-based filter graph subsumes the cuts trivially).
//
// No mocks. Tests run real ffmpeg on generated fixtures.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { z } from "zod";
import { getObject, putObject, signedReadUrl } from "@shri/storage";
import type { ToolContext } from "./descriptors.js";

const exec = promisify(execFile);

export const transitionKindSchema = z.enum([
  "hard_cut",
  "match_cut",
  "dissolve",
  "fade",
]);

export type TransitionKind = z.infer<typeof transitionKindSchema>;

export const inputSchema = z
  .object({
    projectSlug: z.string().min(1),
    itemId: z.string().min(1),
    // Ordered list of per-scene MP4 R2 keys (keys.outputSeedanceScene normally).
    videoR2Keys: z.array(z.string().min(1)).min(2),
    // length must be videoR2Keys.length - 1.
    transitions: z.array(transitionKindSchema),
    // Where to write the concatenated MP4. Caller picks; typically
    // keys.outputFinal(...) or an intermediate concat key before mux.
    outputR2Key: z.string().min(1),
    // For xfade transitions only. Seconds of overlap. Default 0.3s feels good
    // for short reels per docs/17 example.
    xfadeDurationS: z.number().positive().default(0.3),
  })
  .refine((d) => d.transitions.length === d.videoR2Keys.length - 1, {
    message: "transitions.length must equal videoR2Keys.length - 1",
    path: ["transitions"],
  });

export type ToolInput = z.infer<typeof inputSchema>;

export const outputSchema = z.object({
  r2Key: z.string(),
  url: z.string(),
});

export type ToolOutput = z.infer<typeof outputSchema>;

function getFfmpegBinary(): string {
  const path = ffmpegStatic as unknown as string | null;
  if (!path) {
    throw new Error(
      "concatVideos: ffmpeg-static did not provide a binary for this platform.",
    );
  }
  return process.env.FFMPEG_PATH ?? path;
}

/**
 * Pure helper: do any of the transitions require the xfade re-encode path?
 * Exported for tests and for the orchestrator to estimate cost / time.
 */
export function needsXfade(transitions: TransitionKind[]): boolean {
  return transitions.some((t) => t === "dissolve" || t === "fade");
}

/**
 * Probe a single file's duration (seconds). Tries fluent-ffmpeg's ffprobe and
 * falls back to parsing `ffmpeg -i` stderr (ffmpeg-static ships no ffprobe).
 */
async function probeDurationS(path: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(path, async (err, data) => {
      if (!err) {
        const d = data.format.duration;
        if (typeof d === "number" && !Number.isNaN(d)) return resolve(d);
      }
      try {
        const bin = getFfmpegBinary();
        const { stderr } = await exec(bin, ["-i", path]).catch((e: unknown) => {
          // ffmpeg returns non-zero with no output file; its stderr still
          // carries Duration: lines we can parse.
          const ee = e as { stderr?: string };
          return { stderr: ee.stderr ?? "" };
        });
        const m = /Duration:\s+(\d+):(\d+):(\d+\.\d+)/.exec(stderr ?? "");
        if (!m) return reject(new Error(`probeDurationS: cannot parse: ${stderr}`));
        const h = Number(m[1]);
        const min = Number(m[2]);
        const s = Number(m[3]);
        resolve(h * 3600 + min * 60 + s);
      } catch (e) {
        reject(e as Error);
      }
    });
  });
}

/**
 * Lossless concat demuxer path. All inputs must share codec, resolution,
 * framerate. Seedance outputs already do — that's why this is the fast path.
 */
export async function concatDemuxerLocal(
  inputPaths: string[],
  outPath: string,
  workDir: string,
): Promise<void> {
  const listPath = join(workDir, "list.txt");
  const lines = inputPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, lines);

  const bin = getFfmpegBinary();
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .setFfmpegPath(bin)
      .input(listPath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .on("error", (err) => reject(new Error(`concat demuxer failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(outPath);
  });
}

/**
 * xfade-filter path. Builds a filter_complex chain that crossfades each pair
 * of clips at `xfadeDurationS` seconds of overlap. The xfade `offset` for each
 * boundary is the running total of clip durations minus the xfade duration.
 *
 * For 'dissolve' we use xfade=transition=dissolve; for 'fade' we use
 * xfade=transition=fade (Seedance/BytePlus equivalent: a soft fade-thru-black
 * feel). All ffmpeg builds with xfade support both.
 *
 * Note: this implementation handles a mixed transition list by treating
 * 'hard_cut' / 'match_cut' as an xfade of duration ~0 (`offset = end`) so the
 * chain stays uniform. That keeps the filter graph predictable; the cost is
 * the whole timeline gets re-encoded.
 */
export async function concatXfadeLocal(
  inputPaths: string[],
  transitions: TransitionKind[],
  outPath: string,
  xfadeDurationS: number,
): Promise<void> {
  const durations = await Promise.all(inputPaths.map(probeDurationS));

  // Build the filter graph step by step.
  // Inputs: [0:v] [1:v] ... we ignore audio for now (multi-scene reels are
  // generated with audioMode=voiceover OR seedance-per-scene; concat is run
  // before any voiceover mux, and per-scene seedance audio is dropped). The
  // mux step downstream re-attaches audio when applicable.
  const filterParts: string[] = [];
  let prevLabel = "[0:v]";
  let runningOffset = 0;

  for (let i = 0; i < inputPaths.length - 1; i++) {
    const transition = transitions[i]!;
    const isCut = transition === "hard_cut" || transition === "match_cut";
    const ffName = transition === "dissolve" ? "dissolve" : "fade";
    const d = isCut ? 0.01 : xfadeDurationS;
    // offset = where in the combined timeline the next clip should START
    // crossfading in. For the first boundary: durations[0] - d.
    runningOffset += durations[i]! - d;
    const outLabel = `[v${i + 1}]`;
    filterParts.push(
      `${prevLabel}[${i + 1}:v]xfade=transition=${ffName}:duration=${d}:offset=${runningOffset.toFixed(3)}${outLabel}`,
    );
    prevLabel = outLabel;
  }

  const bin = getFfmpegBinary();
  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg().setFfmpegPath(bin);
    for (const p of inputPaths) cmd.input(p);
    cmd
      .complexFilter(filterParts.join(";"), [prevLabel.replace(/[\[\]]/g, "")])
      .outputOptions(["-c:v libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an"])
      .on("error", (err) => reject(new Error(`xfade concat failed: ${err.message}`)))
      .on("end", () => resolve())
      .save(outPath);
  });
}

/**
 * Pick + dispatch the right strategy. Pure (modulo ffmpeg I/O).
 */
export async function concatLocal(
  inputPaths: string[],
  transitions: TransitionKind[],
  outPath: string,
  workDir: string,
  xfadeDurationS = 0.3,
): Promise<void> {
  if (inputPaths.length < 2) {
    throw new Error("concatLocal: need at least 2 input videos");
  }
  if (transitions.length !== inputPaths.length - 1) {
    throw new Error(
      "concatLocal: transitions.length must equal inputPaths.length - 1",
    );
  }
  if (needsXfade(transitions)) {
    await concatXfadeLocal(inputPaths, transitions, outPath, xfadeDurationS);
  } else {
    await concatDemuxerLocal(inputPaths, outPath, workDir);
  }
}

export async function handler(
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolOutput> {
  const input = inputSchema.parse(rawInput);

  // Orchestrator owns logging.
  void ctx;

  const work = await mkdtemp(join(tmpdir(), "shri-concat-"));
  try {
    const localPaths: string[] = [];
    for (let i = 0; i < input.videoR2Keys.length; i++) {
      const buf = await getObject(input.videoR2Keys[i]!);
      const p = join(work, `scene-${i}.mp4`);
      await writeFile(p, buf);
      localPaths.push(p);
    }
    const outPath = join(work, "concat.mp4");
    await concatLocal(
      localPaths,
      input.transitions,
      outPath,
      work,
      input.xfadeDurationS,
    );

    const outBuf = await readFile(outPath);
    await putObject(input.outputR2Key, outBuf, "video/mp4");
    const url = await signedReadUrl(input.outputR2Key, 3600);
    return { r2Key: input.outputR2Key, url };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
