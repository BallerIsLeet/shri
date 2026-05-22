import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// R2 exposes an S3-compatible endpoint at https://{accountId}.r2.cloudflarestorage.com.
// We never construct keys here — they all come from ./keys.ts. See docs/08.

export type R2Env = {
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  R2_PUBLIC_BASE_URL: string;
};

function readEnv(): R2Env {
  const required = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE_URL",
  ] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `@shri/storage: missing required env vars: ${missing.join(", ")}. ` +
        `See .env.example.`,
    );
  }
  return {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID!,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID!,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY!,
    R2_BUCKET: process.env.R2_BUCKET!,
    R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL!,
  };
}

let cached: { client: S3Client; env: R2Env } | undefined;

function getClient(): { client: S3Client; env: R2Env } {
  if (cached) return cached;
  const env = readEnv();
  const cfg: S3ClientConfig = {
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  };
  cached = { client: new S3Client(cfg), env };
  return cached;
}

export type PutResult = {
  key: string;
  url: string; // public URL — only resolvable if the bucket has a public custom domain
};

// Exported for unit testing — pure URL composition that putObject uses.
export function publicUrlFor(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<PutResult> {
  const { client, env } = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { key, url: publicUrlFor(env.R2_PUBLIC_BASE_URL, key) };
}

export async function getObject(key: string): Promise<Buffer> {
  const { client, env } = getClient();
  const res = await client.send(
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
  );
  if (!res.Body) {
    throw new Error(`@shri/storage: empty response body for key ${key}`);
  }
  // SDK Body is a streaming Blob/Readable in Node — transformToByteArray normalises both.
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function signedReadUrl(key: string, ttlSec = 3600): Promise<string> {
  const { client, env } = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    { expiresIn: ttlSec },
  );
}

export async function signedPutUrl(
  key: string,
  contentType: string,
  ttlSec = 300,
): Promise<string> {
  const { client, env } = getClient();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: ttlSec },
  );
}

// Test-only: lets vitest reset between tests that vary env.
export function __resetR2ClientForTests(): void {
  cached = undefined;
}
