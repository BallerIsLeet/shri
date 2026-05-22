"use client";

import { useState, type FormEvent } from "react";
import clsx from "clsx";

// Minimal, home-grown chat panel. No streaming (tRPC mutation returns the full
// reply); single-user app, this is enough. If the LLM proposes a description,
// the parent surfaces an "Adopt description" button (we surface that via the
// `onAdoptSuggestion` callback when a turn has one).

export type ChatTurn = { role: "user" | "assistant"; content: string };

export function ChatPanel({
  turns,
  pending,
  onSend,
  suggestion,
  onAdoptSuggestion,
}: {
  turns: ChatTurn[];
  pending: boolean;
  onSend: (message: string) => void;
  suggestion?: string | null;
  onAdoptSuggestion?: (description: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState("");

  function submit(e: FormEvent): void {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div className="flex h-full flex-col rounded-md border border-ink/10 bg-white">
      <div className="min-h-[300px] flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <p className="muted text-sm">
            Describe the character you want — species, vibe, palette, style. The
            assistant will ask follow-ups and propose a canonical description.
          </p>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={clsx(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm",
              t.role === "user"
                ? "ml-auto bg-ink text-white"
                : "bg-cream text-ink",
            )}
          >
            {t.content}
          </div>
        ))}
        {pending && (
          <div className="muted text-xs italic">assistant thinking…</div>
        )}
      </div>
      {suggestion && onAdoptSuggestion && (
        <div className="border-t border-ink/10 bg-cream/40 p-3 text-xs">
          <div className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">
            Suggested description
          </div>
          <p className="whitespace-pre-wrap text-ink">{suggestion}</p>
          <button
            type="button"
            className="btn btn-primary mt-2"
            onClick={() => onAdoptSuggestion(suggestion)}
          >
            Use this description
          </button>
        </div>
      )}
      <form
        onSubmit={submit}
        className="flex items-end gap-2 border-t border-ink/10 p-3"
      >
        <textarea
          className="input min-h-[60px] resize-y"
          value={draft}
          placeholder="Type a message…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit(e as unknown as FormEvent);
            }
          }}
          disabled={pending}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !draft.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
