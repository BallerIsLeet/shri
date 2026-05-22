# 01 — Data Flow

**Purpose:** Show the end-to-end lifecycle of a content job, from product creation to a downloadable asset, including every persisted state transition along the way.

---

## The full lifecycle

```mermaid
sequenceDiagram
    actor U as You
    participant W as Web (Next.js)
    participant DB as Postgres
    participant R2 as Cloudflare R2
    participant Q as BullMQ
    participant WK as Worker
    participant L as LLM (OpenAI-compat)
    participant SD as Seedance

    U->>W: Create project (name, desc, highlights)
    W->>DB: INSERT Project + copy default prompts<br/>→ prompts-projects/{slug}/
    U->>W: Upload assets
    W->>R2: presigned PUT (icon, screenshots, recording)
    W->>DB: INSERT Asset rows (r2Key, mime, dims)
    U->>W: Click "Generate brief"
    W->>Q: enqueue Job(kind=BRIEF, projectId)
    Q->>WK: claim job
    WK->>L: chat completion w/ tools<br/>(prompts + asset URLs)
    L-->>WK: tool calls: list_project_assets, estimate_cost, ...
    WK->>L: tool results
    L-->>WK: final JSON brief w/ FULLY ELABORATED conceptJson per item
    WK->>DB: INSERT Brief + N × ContentItem (PROPOSED)<br/>both aiConceptJson and conceptJson populated
    WK->>Q: ACK done

    Note over U,W: User can expand any row to edit conceptJson<br/>(Seedance prompt, camera angles, slide specs, etc.)
    U->>W: Edit item.conceptJson (optional)
    W->>DB: UPDATE ContentItem.conceptJson, bump conceptRevision

    U->>W: Select rows, click "Generate selected"
    W->>DB: UPDATE ContentItem.status = SELECTED
    W->>Q: enqueue Job per selected item
    Q->>WK: claim CAROUSEL job
    Note over WK: NO LLM loop — deterministic pipeline using conceptJson
    WK->>WK: resolve embeddedImagePrompts → R2 keys
    WK->>R2: PUT generated PNGs (via Satori)
    WK->>DB: INSERT ContentOutput + UPDATE item.status=READY
    Q->>WK: claim REEL job
    Note over WK: NO LLM loop — uses conceptJson.seedanceScript as-is
    WK->>SD: submit_seedance_job(prompt, cameraPerspective) → taskId
    SD-->>WK: { taskId }
    WK->>Q: re-enqueue self with delay=15s (releases worker)
    Q->>WK: claim polling tick
    WK->>SD: poll(taskId)
    alt still running
        WK->>Q: re-enqueue with delay=15s
    else succeeded
        SD-->>WK: { video_url }
        WK->>R2: download → PUT to projects/{slug}/outputs/
        WK->>L: (optional) generate_tts for voiceover mode
        WK->>WK: mux_audio (ffmpeg)
        WK->>R2: PUT final MP4
        WK->>DB: INSERT ContentOutput + UPDATE item.status=READY
    end

    U->>W: Open item detail
    W->>R2: presigned GET → preview + download
```

---

## State machines

### `ContentItem.status`

```
        +----------+   user selects   +----------+
        | PROPOSED |─────────────────►| SELECTED |
        +----------+                  +----------+
                                            │
                                            │ worker picks up
                                            ▼
                                      +------------+
                                      | GENERATING |
                                      +------------+
                                            │
                              success ┌─────┴─────┐ failure
                                      ▼           ▼
                                +--------+   +--------+
                                | READY  |   | FAILED |
                                +--------+   +--------+
```

`PROPOSED` → never enqueued, just suggested by the brief. Cheap to discard.
`SELECTED` → in the queue or about to be.
`GENERATING` → a worker has it claimed; logs accumulating in `Job.logs`.
`READY` → at least one `ContentOutput` exists for this item.
`FAILED` → `Job.error` populated; surfaces in `/jobs`.

### `Job.status`

```
QUEUED → RUNNING → DONE
                  ↘ FAILED (terminal, with error)
```

A single ContentItem can spawn multiple Jobs over its lifetime (initial generation, manual re-run, polling ticks for Seedance). Each Seedance polling tick is its own delayed re-enqueue of the same job spec, not a new Job row — `Job.logs` accumulates across ticks.

---

## Why this shape

**Brief generation is decoupled from item generation.** You always get the table first. Briefs are cheap; finished media is expensive. The selection step is where you spend money.

**Seedance polling does not block a worker.** A naive implementation would call `submit` then `poll` in a tight loop for 90 seconds while holding a BullMQ worker. Instead, after `submit` we re-enqueue the same job with a 15s delay. The worker is freed immediately and can run other jobs. When the delay fires, the job comes back, polls once, and either finishes or re-enqueues again. This means a single worker can handle ~50 concurrent Seedance jobs.

**All artifacts live in R2 keyed by project slug.** Easy to delete a project's blob storage; easy to audit; presigned URLs let Seedance fetch your inputs and let you serve previews without proxying through Next.js.

---

## See also
- [02-orchestrator.md](02-orchestrator.md) — the LLM loop that powers brief + item jobs
- [04-seedance.md](04-seedance.md) — Seedance task lifecycle in detail
- [08-storage-and-data.md](08-storage-and-data.md) — the Prisma schema and R2 key layout
