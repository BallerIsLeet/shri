#!/usr/bin/env tsx
/**
 * Manual Seedance smoke — user-run live test against real BytePlus.
 *
 * Run with:
 *
 *   pnpm tsx scripts/manual-seedance-smoke.ts
 *
 * Required env (loaded from .env or your shell):
 *   ARK_API_KEY             — your BytePlus key
 *   R2_ACCOUNT_ID           — and the rest of the R2_* block from .env.example
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 *   R2_PUBLIC_BASE_URL
 *
 * Optional env:
 *   ARK_BASE_URL            — defaults to ark.ap-southeast.bytepluses.com
 *   ARK_VIDEO_MODEL         — defaults to dreamina-seedance-2-0-260128
 *   SMOKE_PROJECT_SLUG      — defaults to "smoke"
 *   SMOKE_ITEM_ID           — defaults to "smoke-<timestamp>"
 *   SMOKE_PROMPT            — defaults to a tiny "wide shot, eye level..." prompt
 *
 * What it does:
 *   1. Submits ONE short 6-second 9:16 silent reel to BytePlus Seedance.
 *   2. Polls every 10 s until the job is terminal (succeeded / failed).
 *   3. On succeeded → downloads the MP4 to R2 under projects/{slug}/outputs/{itemId}/seedance.mp4
 *      and prints the R2 key + public URL.
 *
 * NO MOCKS. Real BytePlus HTTP, real R2 upload. See CLAUDE.md convention #4.
 *
 * This is the ONLY automated path that touches the live Seedance API. The
 * unit tests in submitSeedance.test.ts and pollSeedance.test.ts exercise pure
 * logic only.
 */

import { downloadToR2, poll, submit } from "@shri/seedance";
import { keys } from "@shri/storage";

const TICK_MS = 10_000;
const MAX_TICKS = 30; // ~5 min ceiling
const TIMEOUT_S = (TICK_MS * MAX_TICKS) / 1000;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  requireEnv("ARK_API_KEY");
  requireEnv("R2_ACCOUNT_ID");
  requireEnv("R2_ACCESS_KEY_ID");
  requireEnv("R2_SECRET_ACCESS_KEY");
  requireEnv("R2_BUCKET");
  requireEnv("R2_PUBLIC_BASE_URL");

  const slug = process.env.SMOKE_PROJECT_SLUG ?? "smoke";
  const itemId = process.env.SMOKE_ITEM_ID ?? `smoke-${Date.now()}`;
  const prompt =
    process.env.SMOKE_PROMPT ??
    [
      "A still wide shot of a wooden desk by a window in soft afternoon light. " +
        "A small green plant in a terracotta pot sits in the corner of the frame.",
      "wide shot, eye level. static camera, normal lens, shallow dof.",
    ].join("\n\n");

  console.log("=== Shri Seedance smoke ===");
  console.log(`project: ${slug}`);
  console.log(`item:    ${itemId}`);
  console.log(`model:   ${process.env.ARK_VIDEO_MODEL ?? "(default)"}`);
  console.log("prompt:");
  console.log(prompt.replace(/^/gm, "  "));
  console.log("");

  console.log("→ submit");
  const start = Date.now();
  const { taskId } = await submit({
    prompt,
    generateAudio: false,
    ratio: "9:16",
  });
  console.log(`  taskId: ${taskId}`);

  for (let i = 0; i < MAX_TICKS; i++) {
    await sleep(TICK_MS);
    const elapsedS = ((Date.now() - start) / 1000).toFixed(1);
    process.stdout.write(`→ poll #${i + 1} (${elapsedS}s elapsed)…`);
    const res = await poll(taskId);
    process.stdout.write(` status=${res.status}\n`);

    if (res.status === "failed") {
      console.error(`× failed: ${res.error?.message ?? "(no message)"}`);
      process.exit(2);
    }
    if (res.status === "succeeded") {
      if (!res.videoUrl) {
        console.error("× succeeded but no video_url in response");
        process.exit(3);
      }
      const key = keys.outputSeedance(slug, itemId);
      console.log(`→ download → R2 (${key})`);
      const dl = await downloadToR2(res.videoUrl, key);
      console.log("");
      console.log("✓ done");
      console.log(`  r2Key: ${dl.key}`);
      console.log(`  url:   ${dl.url}`);
      console.log(`  total: ${((Date.now() - start) / 1000).toFixed(1)}s`);
      return;
    }
  }

  console.error(`× timed out after ~${TIMEOUT_S}s without a terminal status`);
  process.exit(4);
}

main().catch((err) => {
  console.error("× smoke failed");
  console.error(err);
  process.exit(1);
});
