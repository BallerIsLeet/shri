// concatVideos.test.ts — real ffmpeg, generated fixtures. No mocks.

import { existsSync, statSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  concatLocal,
  inputSchema,
  needsXfade,
  transitionKindSchema,
} from "./concatVideos.js";

const exec = promisify(execFile);
const FFMPEG = ffmpegStatic as unknown as string | null;

const FIX_DIR = new URL("./__fixtures__/", import.meta.url).pathname;
const OUT_DIR = new URL("./__fixtures__/tmp-concat/", import.meta.url).pathname;
const CLIP_A = join(FIX_DIR, "clip-a.mp4");
const CLIP_B = join(FIX_DIR, "clip-b.mp4");

async function ensureFixtures(): Promise<void> {
  if (!FFMPEG) throw new Error("ffmpeg-static missing");
  await mkdir(FIX_DIR, { recursive: true });
  // Identical specs (320x240, 24fps, yuv420p, H.264, AAC) so the concat
  // demuxer can do a no-re-encode pass.
  const args = (color: string, freq: number, out: string): string[] => [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `color=c=${color}:size=320x240:rate=24`,
    "-f", "lavfi", "-i", `sine=frequency=${freq}:sample_rate=44100`,
    "-t", "2",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "64k",
    "-shortest",
    out,
  ];
  if (!existsSync(CLIP_A)) await exec(FFMPEG, args("red", 440, CLIP_A));
  if (!existsSync(CLIP_B)) await exec(FFMPEG, args("blue", 660, CLIP_B));
}

async function probeDurationS(path: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(path, async (err, data) => {
      if (!err) {
        const d = data.format.duration;
        if (typeof d === "number") return resolve(d);
      }
      if (!FFMPEG) return reject(err);
      try {
        const { stderr } = await exec(FFMPEG, ["-i", path]).catch((e: unknown) => {
          const ee = e as { stderr?: string };
          return { stderr: ee.stderr ?? "" };
        });
        const m = /Duration:\s+(\d+):(\d+):(\d+\.\d+)/.exec(stderr ?? "");
        if (!m) return reject(new Error("no duration parse"));
        resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
      } catch (e) {
        reject(e as Error);
      }
    });
  });
}

describe("concatVideos (real ffmpeg)", () => {
  beforeAll(async () => {
    if (!FFMPEG) throw new Error("ffmpeg-static missing");
    await ensureFixtures();
    await mkdir(OUT_DIR, { recursive: true });
  }, 60_000);

  afterAll(async () => {
    await rm(OUT_DIR, { recursive: true, force: true });
  });

  it("needsXfade is true iff any transition is dissolve or fade", () => {
    expect(needsXfade(["hard_cut", "match_cut"])).toBe(false);
    expect(needsXfade(["hard_cut", "dissolve"])).toBe(true);
    expect(needsXfade(["fade"])).toBe(true);
    expect(needsXfade(["match_cut"])).toBe(false);
  });

  it("hard_cut: concat demuxer path produces a valid MP4 of summed duration", async () => {
    const out = join(OUT_DIR, "hardcut.mp4");
    await concatLocal([CLIP_A, CLIP_B], ["hard_cut"], out, OUT_DIR);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(1024);
    const d = await probeDurationS(out);
    // Two 2s clips, lossless concat → ~4s.
    expect(d).toBeGreaterThan(3.5);
    expect(d).toBeLessThan(4.5);
  }, 60_000);

  it("match_cut: concat demuxer path (same fast path as hard_cut)", async () => {
    const out = join(OUT_DIR, "matchcut.mp4");
    await concatLocal([CLIP_A, CLIP_B], ["match_cut"], out, OUT_DIR);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(1024);
    const d = await probeDurationS(out);
    expect(d).toBeGreaterThan(3.5);
    expect(d).toBeLessThan(4.5);
  }, 60_000);

  it("dissolve: xfade path produces a valid MP4 with overlap (duration < sum)", async () => {
    const out = join(OUT_DIR, "dissolve.mp4");
    await concatLocal([CLIP_A, CLIP_B], ["dissolve"], out, OUT_DIR, 0.5);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(1024);
    const d = await probeDurationS(out);
    // xfade with 0.5s overlap on 2s+2s → ~3.5s
    expect(d).toBeGreaterThan(3.0);
    expect(d).toBeLessThan(4.0);
  }, 60_000);

  it("fade: xfade path produces a valid MP4 with overlap", async () => {
    const out = join(OUT_DIR, "fade.mp4");
    await concatLocal([CLIP_A, CLIP_B], ["fade"], out, OUT_DIR, 0.3);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(1024);
    const d = await probeDurationS(out);
    // xfade with 0.3s overlap on 2s+2s → ~3.7s
    expect(d).toBeGreaterThan(3.0);
    expect(d).toBeLessThan(4.5);
  }, 60_000);

  it("throws when transitions length doesn't match videos.length - 1", async () => {
    const out = join(OUT_DIR, "broken.mp4");
    await expect(
      concatLocal([CLIP_A, CLIP_B], [], out, OUT_DIR),
    ).rejects.toThrow(/transitions.length/);
  });

  it("throws when given fewer than 2 inputs", async () => {
    const out = join(OUT_DIR, "broken.mp4");
    await expect(
      concatLocal([CLIP_A], [], out, OUT_DIR),
    ).rejects.toThrow(/at least 2/);
  });
});

describe("concatVideos schemas", () => {
  it("transitionKindSchema enumerates the four supported kinds", () => {
    for (const t of ["hard_cut", "match_cut", "dissolve", "fade"] as const) {
      expect(transitionKindSchema.parse(t)).toBe(t);
    }
    expect(transitionKindSchema.safeParse("whip_pan").success).toBe(false);
  });

  it("inputSchema requires transitions.length === videoR2Keys.length - 1", () => {
    const ok = inputSchema.safeParse({
      projectSlug: "demo",
      itemId: "item_1",
      videoR2Keys: ["a.mp4", "b.mp4", "c.mp4"],
      transitions: ["hard_cut", "hard_cut"],
      outputR2Key: "out.mp4",
    });
    expect(ok.success).toBe(true);

    const bad = inputSchema.safeParse({
      projectSlug: "demo",
      itemId: "item_1",
      videoR2Keys: ["a.mp4", "b.mp4", "c.mp4"],
      transitions: ["hard_cut"], // wrong length
      outputR2Key: "out.mp4",
    });
    expect(bad.success).toBe(false);
  });

  it("inputSchema rejects fewer than 2 videos", () => {
    const bad = inputSchema.safeParse({
      projectSlug: "demo",
      itemId: "item_1",
      videoR2Keys: ["only.mp4"],
      transitions: [],
      outputR2Key: "out.mp4",
    });
    expect(bad.success).toBe(false);
  });

  it("inputSchema defaults xfadeDurationS to 0.3", () => {
    const ok = inputSchema.parse({
      projectSlug: "demo",
      itemId: "item_1",
      videoR2Keys: ["a.mp4", "b.mp4"],
      transitions: ["dissolve"],
      outputR2Key: "out.mp4",
    });
    expect(ok.xfadeDurationS).toBe(0.3);
  });
});
