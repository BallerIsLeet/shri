"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { MarkdownEditor } from "@/components/MarkdownEditor";

// Markdown editor for the seven allowlisted per-project prompt files.
// Save via tRPC → executeTool("write_project_prompt", ...). CLAUDE.md #9.

export default function PromptsPage({
  params,
}: {
  params: { slug: string };
}): JSX.Element {
  const { slug } = params;
  const list = trpc.prompt.list.useQuery();
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const utils = trpc.useUtils();
  const write = trpc.prompt.write.useMutation({
    onSuccess: async () => {
      if (active) await utils.prompt.read.invalidate({ projectSlug: slug, file: active });
    },
  });

  useEffect(() => {
    if (list.data && list.data.length > 0 && !active) {
      setActive(list.data[0]!);
    }
  }, [list.data, active]);

  const read = trpc.prompt.read.useQuery(
    active ? { projectSlug: slug, file: active } : { projectSlug: slug, file: "director-brief.md" },
    { enabled: !!active },
  );

  useEffect(() => {
    if (read.data) setDraft(read.data.content);
  }, [read.data]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Project prompts</h1>
      <p className="muted text-sm">
        Per-project markdown that shapes the brief, planner, and per-tool output.
        Seven allowlisted files.
      </p>
      <div className="flex flex-wrap gap-2">
        {list.data?.map((f) => (
          <button
            key={f}
            type="button"
            className={`btn ${active === f ? "btn-primary" : ""}`}
            onClick={() => setActive(f)}
          >
            {f}
          </button>
        ))}
      </div>
      {active && (
        <div className="card">
          {read.isLoading && <p className="muted">Loading…</p>}
          {read.data && (
            <>
              <MarkdownEditor value={draft} onChange={setDraft} height={520} />
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDraft(read.data!.content)}
                  disabled={write.isPending}
                >
                  Revert
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    write.mutate({
                      projectSlug: slug,
                      file: active,
                      content: draft,
                    })
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
      )}
    </div>
  );
}
