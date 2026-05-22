"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Dropzone } from "@/components/Dropzone";

// /projects/new — name, description, highlights, optional product URL.
// On submit: create project → upload assets → crawl (if URL) → generate prompts.

type PendingAsset = { file: File; kind: AssetKind; uploaded: boolean; r2Key?: string };

const ASSET_KINDS = ["ICON", "SCREENSHOT", "SCREEN_RECORDING", "LOGO", "REFERENCE"] as const;
type AssetKind = (typeof ASSET_KINDS)[number];

function inferKind(file: File): AssetKind {
  if (file.type.startsWith("video/")) return "SCREEN_RECORDING";
  if (file.name.toLowerCase().includes("icon")) return "ICON";
  if (file.name.toLowerCase().includes("logo")) return "LOGO";
  return "SCREENSHOT";
}

export default function NewProjectPage(): JSX.Element {
  const router = useRouter();
  const utils = trpc.useUtils();
  const create = trpc.project.create.useMutation();
  const presign = trpc.asset.presignUpload.useMutation();
  const confirm = trpc.asset.confirm.useMutation();
  const crawl = trpc.project.crawl.useMutation();
  const genPrompts = trpc.project.generatePrompts.useMutation();

  const [form, setForm] = useState({
    name: "",
    description: "",
    highlights: "",
    websiteUrl: "",
  });
  const [pending, setPending] = useState<PendingAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function update<K extends keyof typeof form>(key: K, v: string): void {
    setForm((f) => ({ ...f, [key]: v }));
  }

  function addFiles(files: File[]): void {
    setPending((cur) => [
      ...cur,
      ...files.map((f) => ({ file: f, kind: inferKind(f), uploaded: false })),
    ]);
  }

  function setAssetKind(idx: number, kind: AssetKind): void {
    setPending((cur) =>
      cur.map((p, i) => (i === idx ? { ...p, kind } : p)),
    );
  }

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      setStatus("Creating project…");
      const project = await create.mutateAsync({
        name: form.name,
        description: form.description,
        highlights: form.highlights,
        ...(form.websiteUrl ? { websiteUrl: form.websiteUrl } : {}),
      });

      // 2. Upload assets directly to R2 via presigned PUT URLs.
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i]!;
        setStatus(`Uploading ${p.file.name} (${i + 1}/${pending.length})…`);
        const { uploadUrl, r2Key } = await presign.mutateAsync({
          projectSlug: project.slug,
          filename: p.file.name,
          mimeType: p.file.type || "application/octet-stream",
          kind: p.kind,
        });
        // Browser → R2 directly. NEVER through the Next.js server.
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": p.file.type || "application/octet-stream" },
          body: p.file,
        });
        if (!putRes.ok) {
          throw new Error(
            `R2 upload failed for ${p.file.name}: ${putRes.status} ${putRes.statusText}`,
          );
        }
        await confirm.mutateAsync({
          projectSlug: project.slug,
          r2Key,
          kind: p.kind,
          mimeType: p.file.type || "application/octet-stream",
        });
        setPending((cur) =>
          cur.map((row, idx) => (idx === i ? { ...row, uploaded: true, r2Key } : row)),
        );
      }

      // 3. Optional crawl.
      let productProfile: Record<string, unknown> | undefined;
      if (form.websiteUrl) {
        try {
          setStatus("Crawling product site…");
          const crawled = await crawl.mutateAsync({
            slug: project.slug,
            url: form.websiteUrl,
          });
          productProfile = (crawled as { productProfile?: Record<string, unknown> })
            .productProfile;
        } catch (err) {
          // Crawl failures are non-fatal — fall through to prompt-gen with
          // description + highlights only.
          console.warn("crawl failed", err);
        }
      }

      // 4. Generate per-project prompts.
      try {
        setStatus("Personalizing per-project prompts…");
        await genPrompts.mutateAsync({
          slug: project.slug,
          ...(productProfile ? { productProfile } : {}),
        });
      } catch (err) {
        console.warn("generatePrompts failed", err);
      }

      await utils.project.list.invalidate();
      router.push(`/projects/${project.slug}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  const canSubmit =
    !busy && form.name.trim() && form.description.trim() && form.highlights.trim();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">New project</h1>

      <div className="card space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Project name
          </label>
          <input
            id="name"
            className="input"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="My Todo App"
          />
        </div>
        <div>
          <label className="label" htmlFor="description">
            Description
          </label>
          <textarea
            id="description"
            className="input textarea min-h-[100px]"
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="2-3 sentences about what this product is and who it's for."
          />
        </div>
        <div>
          <label className="label" htmlFor="highlights">
            Highlights
          </label>
          <textarea
            id="highlights"
            className="input textarea min-h-[120px]"
            value={form.highlights}
            onChange={(e) => update("highlights", e.target.value)}
            placeholder="Key features, target audience, voice cues — bullet list is fine."
          />
        </div>
        <div>
          <label className="label" htmlFor="websiteUrl">
            Product website (optional)
          </label>
          <input
            id="websiteUrl"
            className="input"
            value={form.websiteUrl}
            onChange={(e) => update("websiteUrl", e.target.value)}
            placeholder="https://acme.app"
            type="url"
          />
          <p className="muted mt-1 text-xs">
            We'll crawl the homepage + key sub-pages to ground the LLM in real
            product info.
          </p>
        </div>
      </div>

      <div className="card mt-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Assets
          </h2>
          <p className="muted text-xs">
            Drop icons, screenshots, screen recordings, logos. Uploaded directly
            to R2 — never through the Next.js server.
          </p>
        </div>
        <Dropzone onFiles={addFiles} accept="image/*,video/*" multiple disabled={busy} />
        {pending.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Kind</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((p, i) => (
                <tr key={i}>
                  <td>{p.file.name}</td>
                  <td>
                    <select
                      className="select"
                      value={p.kind}
                      onChange={(e) => setAssetKind(i, e.target.value as AssetKind)}
                      disabled={busy}
                    >
                      {ASSET_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="muted">{p.uploaded ? "uploaded" : "queued"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(status || error) && (
        <div className="card mt-4 text-sm">
          {status && <p className="muted">{status}</p>}
          {error && <p className="text-red-600">{error}</p>}
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {busy ? "Working…" : "Create project"}
        </button>
      </div>
    </div>
  );
}
