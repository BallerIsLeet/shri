"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

export default function CharactersPage({
  params,
}: {
  params: { slug: string };
}): JSX.Element {
  const { slug } = params;
  const list = trpc.character.listForProject.useQuery({ projectSlug: slug });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Characters</h1>
        <Link
          href={`/projects/${slug}/characters/new`}
          className="btn btn-primary no-underline"
        >
          + New character
        </Link>
      </div>
      {list.isLoading && <p className="muted">Loading…</p>}
      {list.data && list.data.length === 0 && (
        <div className="card">
          <p className="muted">No characters defined yet.</p>
        </div>
      )}
      {list.data && list.data.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {list.data.map((c) => (
            <Link
              key={c.id}
              href={`/projects/${slug}/characters/${c.id}`}
              className="card no-underline transition hover:bg-cream"
            >
              {c.sheetUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.sheetUrl}
                  alt={c.name}
                  className="h-40 w-full rounded object-cover"
                />
              ) : (
                <div className="muted flex h-40 items-center justify-center rounded bg-cream text-xs">
                  no sheet yet
                </div>
              )}
              <div className="mt-2 text-sm font-medium">{c.name}</div>
              <div className="muted text-xs">
                {c.species ?? "—"} · {c.status}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
