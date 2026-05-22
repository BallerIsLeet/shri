// BytePlus ModelArk Seedance REST contract. See docs/04-seedance.md.
// Not mocked anywhere — only the user-owned smoke script exercises the real API.

export type SeedanceRatio = "9:16" | "1:1" | "16:9" | "adaptive";

export type SeedanceImageRef = {
  // Already-presigned, publicly fetchable URL. The handler in
  // packages/tools/submitSeedance.ts is responsible for presigning from an R2
  // key before calling submit(); this package never builds keys or signs URLs.
  url: string;
};

export type SeedanceSubmitInput = {
  // Final, fully-composed prompt. The orchestrator/tool layer has already
  // prepended camera + reference-tagging sentences before calling this.
  prompt: string;
  images?: SeedanceImageRef[];
  generateAudio: boolean;
  ratio: SeedanceRatio;
  // Optional override; defaults to env.ARK_VIDEO_MODEL.
  model?: string;
};

export type SeedanceSubmitOutput = {
  taskId: string;
};

export type SeedanceStatus = "queued" | "running" | "succeeded" | "failed";

export type SeedancePollOutput = {
  taskId: string;
  status: SeedanceStatus;
  videoUrl?: string;
  error?: {
    code?: string;
    message: string;
  };
};

export type SeedanceDownloadResult = {
  key: string;
  url: string;
};

// Raw shapes per docs/04-seedance.md — kept narrow on purpose so a contract
// drift surfaces as a parse error rather than silent breakage.

export type RawSeedanceSubmitBody = {
  model: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
  generate_audio: boolean;
  ratio: SeedanceRatio;
};

export type RawSeedanceSubmitResponse = {
  id: string;
};

export type RawSeedancePollResponse = {
  id: string;
  status: SeedanceStatus;
  content?: { video_url?: string };
  error?: { code?: string; message: string };
};
