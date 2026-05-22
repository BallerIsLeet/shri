import { putObject } from "@shri/storage";
import type {
  RawSeedancePollResponse,
  RawSeedanceSubmitBody,
  RawSeedanceSubmitResponse,
  SeedanceDownloadResult,
  SeedancePollOutput,
  SeedanceSubmitInput,
  SeedanceSubmitOutput,
} from "./types.js";

// Real `fetch` only. No mocks anywhere, ever. See CLAUDE.md convention #4.

type Env = {
  ARK_API_KEY: string;
  ARK_BASE_URL: string;
  ARK_VIDEO_MODEL: string;
};

function readEnv(): Env {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    throw new Error("@shri/seedance: ARK_API_KEY is required");
  }
  return {
    ARK_API_KEY: apiKey,
    ARK_BASE_URL:
      process.env.ARK_BASE_URL ?? "https://ark.ap-southeast.bytepluses.com",
    ARK_VIDEO_MODEL:
      process.env.ARK_VIDEO_MODEL ?? "dreamina-seedance-2-0-260128",
  };
}

function authHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.ARK_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function submit(
  input: SeedanceSubmitInput,
): Promise<SeedanceSubmitOutput> {
  const env = readEnv();

  const body: RawSeedanceSubmitBody = {
    model: input.model ?? env.ARK_VIDEO_MODEL,
    content: [
      { type: "text", text: input.prompt },
      ...(input.images ?? []).map((img) => ({
        type: "image_url" as const,
        image_url: { url: img.url },
      })),
    ],
    generate_audio: input.generateAudio,
    ratio: input.ratio,
  };

  const res = await fetch(
    `${env.ARK_BASE_URL}/api/v3/contents/generations/tasks`,
    {
      method: "POST",
      headers: authHeaders(env),
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(
      `@shri/seedance: submit failed ${res.status} ${res.statusText}: ${text}`,
    );
  }

  const json = (await res.json()) as RawSeedanceSubmitResponse;
  if (!json.id) {
    throw new Error(
      `@shri/seedance: submit response missing 'id' field: ${JSON.stringify(json)}`,
    );
  }
  return { taskId: json.id };
}

export async function poll(taskId: string): Promise<SeedancePollOutput> {
  const env = readEnv();

  const res = await fetch(
    `${env.ARK_BASE_URL}/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "GET",
      headers: authHeaders(env),
    },
  );

  if (!res.ok) {
    const text = await safeText(res);
    throw new Error(
      `@shri/seedance: poll failed ${res.status} ${res.statusText}: ${text}`,
    );
  }

  const json = (await res.json()) as RawSeedancePollResponse;
  return {
    taskId: json.id,
    status: json.status,
    videoUrl: json.content?.video_url,
    error: json.error,
  };
}

// downloadToR2 takes an already-built R2 key — keys are constructed only in
// @shri/storage/keys.ts (CLAUDE.md convention #2). The caller is responsible.
export async function downloadToR2(
  videoUrl: string,
  key: string,
): Promise<SeedanceDownloadResult> {
  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(
      `@shri/seedance: video download failed ${res.status} ${res.statusText} for ${videoUrl}`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Seedance returns MP4; trust the URL ext but force the content-type for R2.
  const put = await putObject(key, Buffer.from(bytes), "video/mp4");
  return put;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}
