import { signedPutUrl, keys } from "@shri/storage";

// Alternative presign endpoint (POST) for direct fetch use from forms that
// can't easily call tRPC mutations. The canonical path is tRPC's
// asset.presignUpload — this is purely a convenience wrapper that delegates
// to the same @shri/storage helpers and the same key builder.

export const runtime = "nodejs";

type PresignBody = {
  projectSlug?: string;
  filename?: string;
  mimeType?: string;
  assetId?: string;
};

function extFromFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "bin";
  return filename.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(req: Request): Promise<Response> {
  let body: PresignBody;
  try {
    body = (await req.json()) as PresignBody;
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  if (!body.projectSlug || !body.filename || !body.mimeType) {
    return new Response("projectSlug, filename, mimeType required", {
      status: 400,
    });
  }
  const id = body.assetId ?? randomId();
  const ext = extFromFilename(body.filename);
  // CLAUDE.md #2 — keys exclusively from @shri/storage.keys helpers.
  const r2Key = keys.asset(body.projectSlug, id, ext);
  const uploadUrl = await signedPutUrl(r2Key, body.mimeType, 300);
  return Response.json({ uploadUrl, r2Key });
}
