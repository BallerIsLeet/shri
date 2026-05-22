"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { MarkdownEditor } from "@/components/MarkdownEditor";

// /projects/[slug]/theme — dedicated editor for theme-story.md. See
// docs/15-theme-story.md.

const TEMPLATE_HELP = `\
A loose template:

## Setting
Where do these ads take place?

## Mood
Two or three adjectives.

## Visual palette
- Primary colors
- Texture / lighting cues
- What to avoid

## Story arc
The underlying narrative every ad nudges forward.

## Recurring motifs
Small objects, gestures, sounds.

## What to never do
Hard guardrails.
`;

export default function ThemePage({
  params,
}: {
  params: { slug: string };
}): JSX.Element {
  const { slug } = params;
  const file = "theme-story.md";
  const utils = trpc.useUtils();
  const read = trpc.prompt.read.useQuery({ projectSlug: slug, file });
  const write = trpc.prompt.write.useMutation({
    onSuccess: async () => {
      await utils.prompt.read.invalidate({ projectSlug: slug, file });
      await utils.prompt.themeSummary.invalidate({ projectSlug: slug });
    },
  });
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (read.data) setDraft(read.data.content);
  }, [read.data]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Theme &amp; story</h1>
      <p className="muted text-sm">
        Shared creative direction — world, mood, palette, narrative arc — that
        every reel and carousel inherits.
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        <div className="card">
          {read.isLoading && <p className="muted">Loading…</p>}
          {read.data && (
            <>
              <MarkdownEditor value={draft} onChange={setDraft} height={560} />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  className="btn"
                  onClick={() => setDraft(read.data!.content)}
                  disabled={write.isPending}
                >
                  Revert
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    write.mutate({ projectSlug: slug, file, content: draft })
                  }
                  disabled={write.isPending || draft === read.data.content}
                >
                  {write.isPending ? "Saving…" : "Save"}
                </button>
              </div>
              {write.error && (
                <p className="mt-2 text-xs text-red-600">{write.error.message}</p>
              )}
            </>
          )}
        </div>
        <aside className="card text-xs">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Template
          </h2>
          <pre className="muted whitespace-pre-wrap">{TEMPLATE_HELP}</pre>
        </aside>
      </div>
    </div>
  );
}
