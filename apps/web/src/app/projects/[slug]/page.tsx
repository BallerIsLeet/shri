"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

export default function ProjectDashboardPage({
  params,
}: {
  params: { slug: string };
}): JSX.Element {
  const { slug } = params;
  const router = useRouter();
  const utils = trpc.useUtils();

  const project = trpc.project.bySlug.useQuery({ slug });
  const latestBrief = trpc.brief.latestForProject.useQuery({ projectSlug: slug });
  const latestCrawl = trpc.project.latestCrawl.useQuery({ slug });
  const characters = trpc.character.listForProject.useQuery({ projectSlug: slug });
  const theme = trpc.prompt.themeSummary.useQuery({ projectSlug: slug });

  const startBrief = trpc.brief.start.useMutation({
    onSuccess: async (res) => {
      await utils.brief.latestForProject.invalidate();
      router.push(`/projects/${slug}/brief/${res.brief.id}`);
    },
  });
  const recrawl = trpc.project.crawl.useMutation({
    onSuccess: async () => {
      await utils.project.latestCrawl.invalidate({ slug });
    },
  });
  const regenPrompts = trpc.project.generatePrompts.useMutation();

  if (project.isLoading) return <p className="muted">Loading…</p>;
  if (project.error || !project.data) {
    return <p className="text-sm text-red-600">Project not found.</p>;
  }
  const p = project.data;

  return (
    <div className="space-y-6">
      <div>
        <p className="muted text-xs uppercase tracking-wide">Project</p>
        <h1 className="text-2xl font-semibold">{p.name}</h1>
        <p className="muted mt-1 text-sm">{p.description}</p>
      </div>

      {/* Top-row actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-primary"
          onClick={() => startBrief.mutate({ projectSlug: slug })}
          disabled={startBrief.isPending}
        >
          {startBrief.isPending ? "Starting…" : "Generate brief"}
        </button>
        <Link href={`/projects/${slug}/prompts`} className="btn no-underline">
          Edit prompts
        </Link>
        <Link href={`/projects/${slug}/theme`} className="btn no-underline">
          Edit theme
        </Link>
        <Link href={`/projects/${slug}/characters`} className="btn no-underline">
          Characters ({characters.data?.length ?? 0})
        </Link>
      </div>

      {/* Latest brief card */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Latest brief
        </h2>
        {latestBrief.isLoading && <p className="muted text-sm">Loading…</p>}
        {!latestBrief.isLoading && !latestBrief.data && (
          <p className="muted text-sm">
            No brief yet — click "Generate brief" to plan a week of content.
          </p>
        )}
        {latestBrief.data && (
          <div className="mt-2 flex items-center justify-between">
            <div className="text-sm">
              <div>
                Status: <strong>{latestBrief.data.status}</strong>
              </div>
              <div className="muted">
                {new Date(latestBrief.data.createdAt).toLocaleString()} ·{" "}
                {latestBrief.data.rangeDays} days
              </div>
            </div>
            <Link
              href={`/projects/${slug}/brief/${latestBrief.data.id}`}
              className="btn no-underline"
            >
              Open selection table
            </Link>
          </div>
        )}
      </div>

      {/* Crawl & prompts */}
      <div className="card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Crawl & prompts
        </h2>
        {latestCrawl.data ? (
          <div className="mt-2 text-sm">
            <div>
              Last crawled:{" "}
              {new Date(latestCrawl.data.createdAt).toLocaleString()} ·{" "}
              <span className="muted">{latestCrawl.data.status}</span>
            </div>
            {latestCrawl.data.profileJson && (
              <details className="muted mt-2 text-xs">
                <summary className="cursor-pointer">View extracted profile</summary>
                <pre className="mt-2 overflow-auto rounded bg-cream p-2">
                  {JSON.stringify(latestCrawl.data.profileJson, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ) : (
          <p className="muted text-sm">
            No crawl yet{p.websiteUrl ? "" : " — add a websiteUrl to enable."}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {p.websiteUrl && (
            <button
              className="btn"
              onClick={() => recrawl.mutate({ slug, url: p.websiteUrl! })}
              disabled={recrawl.isPending}
            >
              {recrawl.isPending ? "Crawling…" : "Re-crawl"}
            </button>
          )}
          <button
            className="btn"
            onClick={() => regenPrompts.mutate({ slug, overwrite: true })}
            disabled={regenPrompts.isPending}
          >
            {regenPrompts.isPending ? "Regenerating…" : "Regenerate prompts"}
          </button>
        </div>
        {regenPrompts.error && (
          <p className="mt-2 text-xs text-red-600">{regenPrompts.error.message}</p>
        )}
      </div>

      {/* Theme summary */}
      <div className="card">
        <div className="flex items-start justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Theme
          </h2>
          <Link href={`/projects/${slug}/theme`} className="text-xs no-underline">
            Edit theme
          </Link>
        </div>
        {theme.isLoading && <p className="muted text-sm">Loading…</p>}
        {theme.data && (
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="muted text-xs">Mood</dt>
              <dd>{theme.data.mood ?? <span className="muted">(unset)</span>}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Setting</dt>
              <dd>{theme.data.setting ?? <span className="muted">(unset)</span>}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Palette</dt>
              <dd>{theme.data.palette ?? <span className="muted">(unset)</span>}</dd>
            </div>
          </dl>
        )}
      </div>

      {/* Characters mini-list */}
      <div className="card">
        <div className="flex items-start justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Characters
          </h2>
          <Link
            href={`/projects/${slug}/characters/new`}
            className="text-xs no-underline"
          >
            + New character
          </Link>
        </div>
        {characters.isLoading && <p className="muted text-sm">Loading…</p>}
        {characters.data && characters.data.length === 0 && (
          <p className="muted mt-2 text-sm">No characters defined.</p>
        )}
        {characters.data && characters.data.length > 0 && (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {characters.data.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/projects/${slug}/characters/${c.id}`}
                  className="block rounded-md border border-ink/10 bg-white p-2 no-underline transition hover:bg-cream"
                >
                  {c.sheetUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.sheetUrl}
                      alt={c.name}
                      className="h-32 w-full rounded object-cover"
                    />
                  ) : (
                    <div className="muted flex h-32 items-center justify-center rounded bg-cream text-xs">
                      no sheet yet
                    </div>
                  )}
                  <div className="mt-2 text-sm font-medium">{c.name}</div>
                  <div className="muted text-xs">{c.status}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
