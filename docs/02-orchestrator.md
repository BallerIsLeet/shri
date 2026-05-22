# 02 — Orchestrator

**Purpose:** Explain how the LLM-driven loop in `packages/orchestrator/` drives tool calls to produce a brief or an output, and how it stays non-blocking when Seedance takes 90 seconds.

---

## What the orchestrator is

Two entry points, both run inside an `apps/worker` process:

| Function | Job kind | Uses LLM? | Cost profile | Output |
|---|---|---|---|---|
| `runBriefJob(projectId, opts)` | `BRIEF` | Yes — full loop | Text only — ~$0.10-0.15 | A `Brief` row + N `ContentItem` rows with **fully elaborated `conceptJson`** (incl. Seedance prompts, camera perspectives, slide specs). Status `PROPOSED`. |
| `runItemJob(itemId)` | `CAROUSEL` / `REEL` | No (deterministic pipeline) | Real money — image gen + video gen | `ContentOutput` row(s) and `ContentItem.status = READY` |

`runBriefJob` is built on `runLlmLoop`. The loop calls an OpenAI-compatible chat endpoint with `tools` and `tool_choice: "auto"`, executes whatever tool calls come back, feeds results back to the model, and stops when the model emits a final message or hits a configured iteration cap.

`runItemJob` is a **deterministic pipeline** keyed off the user-editable `ContentItem.conceptJson` — see [16-editable-concepts.md](16-editable-concepts.md). It does **not** spin up an LLM loop in the happy path. The narrow escape hatches (slide image regeneration on user request, text-placement retry) are the only places the LLM is invoked at item time.

---

## The loop

```ts
// packages/orchestrator/llmLoop.ts (shape)

async function runLlmLoop(opts: {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDescriptor[];     // from packages/tools
  context: JobContext;         // jobId, projectId, logger
  maxIterations?: number;      // default 12
}): Promise<{ finalMessage: string; iterations: number }> {
  const messages = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userPrompt },
  ];

  for (let i = 0; i < (opts.maxIterations ?? 12); i++) {
    const res = await aiClient.chat.completeWithTools({
      messages,
      tools: opts.tools.map(t => t.openaiSchema),
      toolChoice: "auto",
    });

    const msg = res.message;
    messages.push(msg);

    if (!msg.tool_calls?.length) return { finalMessage: msg.content!, iterations: i };

    // Execute independent tool calls in parallel.
    const results = await Promise.all(
      msg.tool_calls.map(call => executeTool(call, opts.tools, opts.context))
    );

    for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: r.output });
  }

  throw new Error("loop iteration cap reached");
}
```

`executeTool` looks up the descriptor by name, validates arguments against the tool's Zod schema, calls the underlying function, persists a log entry to `Job.logs`, and returns the result as JSON string content. Errors are caught and returned as `{ error: "..." }` so the LLM can react instead of crashing the loop.

---

## Prompt loading

Both run modes load the same six per-project prompt files from `prompts-projects/{slug}/`:

```ts
// packages/orchestrator/loadProjectPrompts.ts
async function loadProjectPrompts(slug: string) {
  return {
    directorBrief:   await readFile(path.join(PROMPTS_DIR, slug, "director-brief.md"), "utf8"),
    carouselPlan:    await readFile(path.join(PROMPTS_DIR, slug, "carousel-plan.md"), "utf8"),
    videoPlan:       await readFile(path.join(PROMPTS_DIR, slug, "video-plan.md"), "utf8"),
    imageCaption:    await readFile(path.join(PROMPTS_DIR, slug, "image-caption.md"), "utf8"),
    textOverlayCopy: await readFile(path.join(PROMPTS_DIR, slug, "text-overlay-copy.md"), "utf8"),
    videoPrompt:     await readFile(path.join(PROMPTS_DIR, slug, "video-prompt.md"), "utf8"),
  };
}
```

No caching. Edits to a `.md` take effect on the next job run. See [07-prompts.md](07-prompts.md) for the full prompt system.

`runBriefJob` composes its system prompt from `directorBrief + carouselPlan + videoPlan`.
`runItemJob` composes from `directorBrief + (carouselPlan | videoPlan) + (imageCaption | textOverlayCopy | videoPrompt)` depending on item type.

---

## Non-blocking Seedance polling

A reel job in BullMQ goes through this state machine:

```
                                          ┌───────────────────────────┐
                                          ▼                           │
[claim] → submit_seedance_job → store taskId → re-enqueue (delay 15s)─┘
                                          │
                                          │ (after delay) claim again
                                          ▼
                          poll_seedance_job(taskId)
                                          │
                       ┌──────────────────┼──────────────────┐
                       │                  │                  │
                  succeeded           still running       failed
                       │                  │                  │
                       ▼                  │                  ▼
            download → R2 → mux           │            Job.status=FAILED
                       │                  │
                       ▼                  ▼
            ContentOutput READY       re-enqueue (delay 15s)
```

The same `Job` row persists across all polling iterations; we just append to `Job.logs`. The worker process is released between polls.

This is the single biggest reason BullMQ + Redis was chosen over a simpler queue: BullMQ has first-class delayed re-enqueue (`job.changeDelay(ms)` / re-add with `delay: ms`), so we don't need cron, custom timers, or a holding-pattern worker.

---

## Parallel tool execution

When the LLM emits multiple `tool_calls` in one response (e.g. "generate 5 image slides in parallel"), the orchestrator runs them concurrently via `Promise.all`. This is the fast path for carousel generation: the model says "make all 6 slides," we kick off 6 image generations at once.

Tools that share state (writing to the same R2 key, mutating the same DB row) are not safe to parallelize, but the descriptors are intentionally designed so each call produces an independent artifact. The shared state is the DB writes at the end of the job, which happen sequentially after all tool calls resolve.

---

## Logging

Every tool call appends to `Job.logs` (a JSONB array column) before and after execution:

```json
[
  { "t": "2026-05-22T12:00:00Z", "kind": "tool_start",  "name": "generate_image", "args": {...} },
  { "t": "2026-05-22T12:00:02Z", "kind": "tool_end",    "name": "generate_image", "ms": 1840, "ok": true, "result": { "r2Key": "..." } },
  { "t": "2026-05-22T12:00:02Z", "kind": "tool_start",  "name": "render_jsx_carousel", "args": {...} },
  { "t": "2026-05-22T12:00:03Z", "kind": "tool_end",    "name": "render_jsx_carousel", "ms": 230, "ok": true, "result": {...} }
]
```

The `/jobs` route in the web app streams these via tRPC polling so you can watch a job execute live.

---

## See also
- [03-tools.md](03-tools.md) — the tool surface the loop calls into
- [04-seedance.md](04-seedance.md) — the polling pattern in detail
- [07-prompts.md](07-prompts.md) — how per-project `.md` prompts feed the loop
