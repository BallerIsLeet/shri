"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

export default function CharacterDetailPage({
  params,
}: {
  params: { slug: string; id: string };
}): JSX.Element {
  const { slug, id } = params;
  const utils = trpc.useUtils();
  const c = trpc.character.get.useQuery({ id });
  const update = trpc.character.update.useMutation({
    onSuccess: async () => {
      await utils.character.get.invalidate({ id });
      await utils.character.listForProject.invalidate({ projectSlug: slug });
    },
  });
  const regenerateBase = trpc.character.regenerateBase.useMutation({
    onSuccess: () => utils.character.get.invalidate({ id }),
  });
  const regenerateViews = trpc.character.regenerateViews.useMutation({
    onSuccess: () => utils.character.get.invalidate({ id }),
  });
  const regenerateSheet = trpc.character.regenerateSheet.useMutation({
    onSuccess: () => utils.character.get.invalidate({ id }),
  });
  const generateSheet = trpc.character.generateSheet.useMutation({
    onSuccess: () => utils.character.get.invalidate({ id }),
  });
  const regeneratePose = trpc.character.regeneratePose.useMutation({
    onSuccess: () => utils.character.get.invalidate({ id }),
  });

  const [draftDescription, setDraftDescription] = useState("");
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    if (c.data) {
      setDraftDescription(c.data.description);
      setDraftName(c.data.name);
    }
  }, [c.data]);

  if (c.isLoading) return <p className="muted">Loading…</p>;
  if (c.error || !c.data) return <p className="text-red-600">Character not found.</p>;

  const char = c.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="card">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Sheet
          </h2>
          {char.sheetUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={char.sheetUrl}
              alt={`${char.name} sheet`}
              className="w-full rounded"
            />
          ) : (
            <div className="muted flex h-72 items-center justify-center rounded bg-cream text-sm">
              No sheet yet — click Generate full sheet.
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              onClick={() =>
                generateSheet.mutate({ projectSlug: slug, characterId: id })
              }
              disabled={generateSheet.isPending}
            >
              {generateSheet.isPending
                ? "Generating…"
                : char.sheetR2Key
                  ? "Re-generate full sheet"
                  : "Generate full sheet"}
            </button>
            <button
              className="btn"
              onClick={() =>
                regenerateBase.mutate({ projectSlug: slug, characterId: id })
              }
              disabled={regenerateBase.isPending}
            >
              Regenerate base
            </button>
            <button
              className="btn"
              onClick={() =>
                regenerateViews.mutate({ projectSlug: slug, characterId: id })
              }
              disabled={regenerateViews.isPending || !char.baseR2Key}
            >
              Regenerate views
            </button>
            <button
              className="btn"
              onClick={() =>
                regenerateSheet.mutate({ projectSlug: slug, characterId: id })
              }
              disabled={regenerateSheet.isPending || char.views.length === 0}
            >
              Regenerate sheet (cheap)
            </button>
          </div>
        </div>

        <aside className="card space-y-3">
          <label className="block">
            <span className="label">Name</span>
            <input
              className="input"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="label">Description</span>
            <textarea
              className="input textarea min-h-[180px]"
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
            />
          </label>
          <div className="muted grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div>Species: {char.species ?? "—"}</div>
            <div>Age: {char.age ?? "—"}</div>
            <div>Gender: {char.gender ?? "—"}</div>
            <div>Status: {char.status}</div>
          </div>
          <button
            className="btn btn-primary w-full"
            disabled={update.isPending || (draftDescription === char.description && draftName === char.name)}
            onClick={() =>
              update.mutate({
                id,
                patch: { description: draftDescription, name: draftName },
              })
            }
          >
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </aside>
      </div>

      {char.views.length > 0 && (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Views
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {char.views.map((v) => (
              <div
                key={v.id}
                className="rounded-md border border-ink/10 bg-white p-2 text-center"
              >
                {v.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={v.url}
                    alt={v.pose}
                    className="h-32 w-full rounded object-cover"
                  />
                ) : (
                  <div className="muted flex h-32 items-center justify-center rounded bg-cream text-xs">
                    pending
                  </div>
                )}
                <div className="mt-1 text-xs font-medium">{v.pose}</div>
                <button
                  type="button"
                  className="btn btn-ghost mt-1 w-full"
                  onClick={() =>
                    regeneratePose.mutate({
                      projectSlug: slug,
                      characterId: id,
                      pose: v.pose,
                    })
                  }
                  disabled={regeneratePose.isPending}
                >
                  Regenerate
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
