"use client";

import { trpc } from "@/lib/trpc";

// Item detail — output preview, caption copy, download.

export default function ItemDetailPage({
  params,
}: {
  params: { slug: string; id: string };
}): JSX.Element {
  const { id } = params;
  const item = trpc.item.get.useQuery({ id });
  const outputs = trpc.output.listByItem.useQuery({ itemId: id });
  const characters = trpc.character.listForItem.useQuery({ itemId: id });

  if (item.isLoading) return <p className="muted">Loading…</p>;
  if (item.error || !item.data) return <p className="text-red-600">Item not found.</p>;

  const it = item.data;

  async function copyCaption(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error("clipboard failed", err);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="muted text-xs uppercase tracking-wide">
          {it.type} · {it.platform.join(", ")} · {it.ratio}
        </p>
        <h1 className="text-2xl font-semibold">{it.hook}</h1>
        <p className="muted mt-1 text-sm">
          rev {it.conceptRevision} · status {it.status} · est ${it.estCostUsd?.toFixed(2)}
        </p>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Outputs
        </h2>
        {outputs.isLoading && <p className="muted text-sm">Loading…</p>}
        {!outputs.isLoading && outputs.data && outputs.data.length === 0 && (
          <p className="muted text-sm">No outputs yet. Generate this item first.</p>
        )}
        {outputs.data && outputs.data.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {outputs.data.map((o) => (
              <li key={o.id} className="rounded-md border border-ink/10 p-3">
                {o.url && (o.r2Key.endsWith(".mp4") ? (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={o.url} controls className="w-full rounded" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.url} alt="output" className="w-full rounded" />
                ))}
                <div className="muted mt-2 text-xs">
                  {new Date(o.createdAt).toLocaleString()}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{o.caption}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void copyCaption(o.caption)}
                  >
                    Copy caption
                  </button>
                  {o.url && (
                    <a className="btn no-underline" href={o.url} download>
                      Download
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Concept JSON
        </h2>
        <pre className="overflow-auto rounded bg-cream p-3 text-xs">
          {JSON.stringify(it.conceptJson, null, 2)}
        </pre>
      </div>

      {characters.data && characters.data.length > 0 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Characters used
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {characters.data.map((c) => (
              <li key={c.character.id} className="text-sm">
                <div className="font-medium">{c.character.name}</div>
                {c.role && <div className="muted text-xs">{c.role}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
