// muxAudio.test.ts — real ffmpeg, real fixture files. No mocks.
// Fixtures are generated at suite setup using ffmpeg-static so the test is
// self-contained and reproducible across machines/CI.

import { existsSync, statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { muxLocal } from "./muxAudio.js";

const exec = promisify(execFile);

const FIX_DIR = new URL("./__fixtures__/", import.meta.url).pathname;
const OUT_DIR = new URL("./__fixtures__/tmp/", import.meta.url).pathname;

const FFMPEG = ffmpegStatic as unknown as string | null;

const CLIP_A = join(FIX_DIR, "clip-a.mp4");
const SILENT = join(FIX_DIR, "silent.mp4");
const VOICE = join(FIX_DIR, "voice.mp3");

async function ensureFixtures(): Promise<void> {
  if (!FFMPEG) throw new Error("ffmpeg-static binary not available");
  await mkdir(FIX_DIR, { recursive: true });
  // clip-a: 2s, 320x240@24, H.264 + AAC (synthetic red + 440Hz sine).
  if (!existsSync(CLIP_A)) {
    await exec(FFMPEG, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "color=c=red:size=320x240:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "2",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "64k",
      "-shortest",
      CLIP_A,
    ]);
  }
  // silent: 2s video, no audio track.
  if (!existsSync(SILENT)) {
    await exec(FFMPEG, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "color=c=green:size=320x240:rate=24",
      "-t", "2",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-an",
      SILENT,
    ]);
  }
  // voice: 2s mono 44.1kHz MP3 sine (523Hz).
  if (!existsSync(VOICE)) {
    await exec(FFMPEG, [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", "sine=frequency=523:sample_rate=44100",
      "-t", "2",
      "-c:a", "libmp3lame", "-b:a", "64k",
      VOICE,
    ]);
  }
}

async function ffprobeDurationS(path: string): Promise<number> {
  // fluent-ffmpeg ships its own ffprobe lookup; ffmpeg-static does NOT include
  // ffprobe, so we re-derive duration by re-encoding to null and reading the
  // reported -t. Cheaper path: use ffmpeg's `-stats` or a quick re-mux into
  // /dev/null — but the simplest portable read is via fluent-ffmpeg's ffprobe
  // which we point at the ffmpeg-static binary's neighbor. If not present,
  // fall back to ffmpeg in PATH (CI hosts typically have it).
  return new Promise<number>((resolve, reject) => {
    // Try system ffprobe first; if absent, the ffmpeg-static module doesn't
    // help us — so we resort to re-running ffmpeg and parsing stderr.
    ffmpeg.ffprobe(path, (err, data) => {
      if (err) {
        // Fallback: spawn FFMPEG and parse "Duration: HH:MM:SS.xx" from stderr.
        if (!FFMPEG) return reject(err);
        execFile(FFMPEG, ["-i", path], (_e, _stdout, stderr) => {
          // ffmpeg returns non-zero when no output file given; that's fine.
          const m = /Duration:\s+(\d+):(\d+):(\d+\.\d+)/.exec(stderr ?? "");
          if (!m) return reject(new Error(`could not parse duration: ${stderr}`));
          const h = Number(m[1]);
          const min = Number(m[2]);
          const s = Number(m[3]);
          resolve(h * 3600 + min * 60 + s);
        });
        return;
      }
      const d = data.format.duration;
      if (typeof d !== "number" || Number.isNaN(d)) {
        return reject(new Error(`ffprobe returned no numeric duration: ${JSON.stringify(data.format)}`));
      }
      resolve(d);
    });
  });
}

describe("muxAudio (real ffmpeg)", () => {
  beforeAll(async () => {
    if (!FFMPEG) {
      throw new Error(
        "ffmpeg-static binary missing — install ffmpeg-static in @shri/tools",
      );
    }
    await ensureFixtures();
    await mkdir(OUT_DIR, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it("combine: silent.mp4 + voice.mp3 → MP4 with audio, duration ≤ source video", async () => {
    const out = join(OUT_DIR, "combined.mp4");
    await muxLocal(SILENT, VOICE, out, "combine");

    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(1024);

    const srcVideoS = await ffprobeDurationS(SILENT);
    const outS = await ffprobeDurationS(out);
    // -shortest clamps to the shorter input. Both are ~2s; allow loose tolerance
    // for container/encoder rounding.
    expect(outS).toBeGreaterThan(0);
    expect(outS).toBeLessThanOrEqual(srcVideoS + 0.5);

    // ffprobe should now report an audio stream (vs SILENT input which had none).
    const outStreams = await new Promise<ffmpeg.FfprobeStream[]>((res, rej) => {
      ffmpeg.ffprobe(out, (e, data) => (e ? rej(e) : res(data.streams)));
    });
    const audioStreams = outStreams.filter((s) => s.codec_type === "audio");
    expect(audioStreams.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("strip: clip-a.mp4 → MP4 with NO audio track", async () => {
    const out = join(OUT_DIR, "stripped.mp4");
    await muxLocal(CLIP_A, undefined, out, "strip");

    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(512);

    const streams = await new Promise<ffmpeg.FfprobeStream[]>((res, rej) => {
      ffmpeg.ffprobe(out, (e, data) => (e ? rej(e) : res(data.streams)));
    });
    const audio = streams.filter((s) => s.codec_type === "audio");
    const video = streams.filter((s) => s.codec_type === "video");
    expect(audio.length).toBe(0);
    expect(video.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("combine throws when audioPath is undefined", async () => {
    const out = join(OUT_DIR, "should-not-exist.mp4");
    await expect(muxLocal(SILENT, undefined, out, "combine")).rejects.toThrow(
      /requires an audioPath/,
    );
  });
});
