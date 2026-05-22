"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";

export default function HomePage(): JSX.Element {
  const { data, isLoading, error } = trpc.project.list.useQuery();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <Link href="/projects/new" className="btn btn-primary no-underline">
          + New Project
        </Link>
      </div>
      {isLoading && <p className="muted">Loading…</p>}
      {error && (
        <p className="text-sm text-red-600">Failed to load: {error.message}</p>
      )}
      {!isLoading && data && data.length === 0 && (
        <div className="card text-center">
          <p className="muted">No projects yet.</p>
          <Link
            href="/projects/new"
            className="btn btn-primary mt-3 no-underline"
          >
            Create your first project
          </Link>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="grid gap-3">
          {data.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.slug}`}
              className="card no-underline transition hover:bg-cream"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  <p className="muted mt-1 line-clamp-2 text-sm">
                    {p.description}
                  </p>
                </div>
                <div className="muted text-right text-xs">
                  <div>
                    {p.counts.briefs} briefs · {p.counts.items} items
                  </div>
                  <div>{p.counts.characters} characters</div>
                  <div className="mt-1">
                    {p.promptsGeneratedAt ? "prompts ready" : "needs setup"}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
