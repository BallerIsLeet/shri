# 16 — Editable Concepts (the Elaborate Script)

**Purpose:** Document the shift from "brief proposes ideas, LLM elaborates at generation time" to "brief proposes fully-elaborated concepts, user edits them, generation is deterministic." This is the layer that makes the Seedance prompt (and every other generation input) something the user can read, tweak, and approve before spending money.

---

## What changes

### Before

```
1. runBriefJob → ContentItem rows with high-level fields:
     { type: "REEL", hook: "...", audioMode: "voiceover", durationS: 8 }
2. User picks rows.
3. runItemJob → LLM expands hook + project prompts into the actual
   Seedance prompt + cameraPerspective at generation time.
4. Seedance call fires immediately.
```

You never see the prompt that goes to Seedance. If it's bad, the only feedback loop is "the video is bad" — you regenerate, the LLM makes a different prompt, you cross fingers.

### After

```
1. runBriefJob → ContentItem rows with FULLY ELABORATED concepts:
     { type: "REEL",
       hook: "...",
       seedanceScript: { prompt, cameraPerspective: {...}, ... },
       audioMode: "voiceover", voiceoverText: "...",
       durationS: 8 }
2. User picks rows AND can expand any row to edit the elaborated concept.
3. runItemJob is now a deterministic pipeline — it uses the edited
   concept as-is, no second LLM call for prompt generation.
4. Seedance call fires with exactly the prompt the user approved.
```

The expensive creative work moves upstream — into the brief job, where it's cheap (text only). The generation job becomes mechanical execution.

---

## The elaborated shape per content type

### REEL — director's scene plan

```ts
type ReelConcept = {
  hook: string;
  durationS: number;                    // sum of scenes[].durationS
  audioMode: "seedance" | "silent" | "voiceover";
  voiceoverText?: string;
  characterIds?: string[];
  caption: string;

  // Director context (see docs/17-director-scenes.md)
  sceneType: SceneType;                 // overall flavor
  environment: Environment;             // shared by every scene

  scenes: Array<{                       // length 1 = single-scene (default); length ≥ 2 = multi-scene
    order: number;
    durationS: number;
    sceneType?: SceneType;              // per-scene override
    seedanceScript: {
      prompt: string;                   // recaps environment for continuity; describes THIS beat
      cameraPerspective: { framing, angle, movement, lens, focus };
    };
    characterViewR2Key?: string;        // i2v anchor for this scene
    transitionToNext?: "hard_cut" | "dissolve" | "match_cut" | "whip_pan" | "fade_to_black";
    notes?: string;
  }>;

  notes?: string;
};
```

The brief LLM populates the entire concept including the environment block. Single-scene is the default; multi-scene is opt-in and only proposed when the content has a real arc. Stitching happens through `concat_videos` only when `scenes.length ≥ 2`. Full design in [17-director-scenes.md](17-director-scenes.md).

### CAROUSEL_CANVA — slide-level specs

```ts
type CanvaCarouselConcept = {
  hook: string;
  characterIds?: string[];
  caption: string;                      // final social-post caption (editable)
  slides: Array<{
    spec: SlideSpec;                    // the JSON layer spec (see docs/05)
    embeddedImagePrompts: Array<{       // any layers that need generation first
      layerId: string;
      prompt: string;
      size: "1024x1024" | "1024x1792" | "1792x1024";
    }>;
    notes?: string;
  }>;
};
```

The LLM writes the full layer spec per slide PLUS the image-gen prompts for any `image` layers that reference yet-to-be-generated assets. User can edit either the spec or the embedded prompts. At generation time the pipeline resolves prompts → R2 keys, substitutes them into the spec, renders via Satori. No LLM call at generation.

### CAROUSEL_TEXT_OVERLAY — base prompt + overlay copy

```ts
type TextOverlayConcept = {
  hook: string;
  characterIds?: string[];
  caption: string;
  basePrompt: string;                   // generate_image prompt for the photo, editable
  overlayText: string;                  // the headline that goes ON the photo
  textStyle: {
    font: "Inter" | "Inter-Bold" | "DM-Serif" | "JetBrains-Mono";
    size: number;
    color: string;
    align?: "left" | "center" | "right";
  };
  notes?: string;
};
```

Generation = `generate_image(basePrompt)` → `place_text_on_image(image, overlayText, textStyle)`. Linear, no LLM call.

---

## The brief LLM does more work upfront

`runBriefJob`'s system prompt now asks for fully-elaborated concepts for every proposed item. The seed template `prompts/director-brief.md` includes:

```markdown
## Output requirements

Each ContentItem you propose MUST be fully elaborated, not a sketch.

For REEL items, populate seedanceScript with:
- A scene-level prompt that describes the subject, action, lighting, mood
- cameraPerspective with ALL FIVE FIELDS filled (framing, angle, movement, lens, focus)
- voiceoverText if audioMode is "voiceover"

For CAROUSEL_CANVA items, populate slides[].spec with the full layer spec
the renderer needs — no placeholders. Include embeddedImagePrompts for any
image layers that depend on generated photos.

For CAROUSEL_TEXT_OVERLAY items, populate basePrompt (for the photo), overlayText,
and textStyle.

For all items, populate caption with the ready-to-post copy.

Treat this as writing the shooting script and shot list. The user will edit
your output before generation; making them rewrite from scratch wastes their
time.
```

Output token cost rises (concepts are 5-10× longer). Brief planning was budgeted at ~$0.03/brief in [10-cost-and-pricing.md](10-cost-and-pricing.md) — push that to ~$0.10-0.15 to be safe. Still cheap relative to image/video gen.

---

## The edit UX

The selection table (`/projects/[slug]/brief/[id]`) gets a per-row "Edit" affordance. Clicking a row opens a drawer with the elaborated concept rendered as a form:

```
┌──────────────────────────────────────────────────────────────────┐
│  Edit reel: "Stop forgetting things"                             │
│  ─────────────────────────────────────────────────────────────── │
│  Hook                                                            │
│  [ Stop forgetting things                                      ] │
│                                                                  │
│  Duration (seconds)         Audio mode                           │
│  [ 8 ]                       [ voiceover ▼ ]                     │
│                                                                  │
│  Voiceover text                                                  │
│  [ Stop forgetting things. Your tasks belong in a place you      │
│    actually open. Try it free.                              ]   │
│                                                                  │
│  Seedance prompt                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ A young woman sits at a wooden desk in warm late-afternoon │ │
│  │ light. She glances at sticky notes piling up around her    │ │
│  │ laptop, sighs, then opens an app on her phone — relief     │ │
│  │ crosses her face as she starts dragging tasks into place.  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Camera                                                          │
│  Framing:    [ medium ▼ ]     Angle:    [ eye_level ▼ ]         │
│  Movement:   [ dolly_in ▼ ]   Lens:     [ normal ▼ ]            │
│  Focus:      [ shallow_dof ▼ ]                                  │
│                                                                  │
│  Character (optional)                                            │
│  [ Maya (the protagonist) ▼ ]   Use view: [ three-quarter ▼ ]   │
│                                                                  │
│  Caption                                                         │
│  [ Sticky notes are not a system. ⏰ link in bio.            ]  │
│                                                                  │
│  Notes (not sent to Seedance)                                    │
│  [                                                            ]  │
│                                                                  │
│  Estimated cost: $1.22                                           │
│                                                                  │
│  [ Reset to AI version ]              [ Cancel ] [ Save script ]│
└──────────────────────────────────────────────────────────────────┘
```

Carousels get a slide-by-slide editor with the same pattern: each slide collapsed by default, clickable to expand into spec + image prompts.

### Reset semantics

Every edit is a write to `ContentItem.conceptJson`. The original LLM output is preserved on `ContentItem.aiConceptJson` so "Reset to AI version" can restore it deterministically. After reset, edits start a new revision.

### Concurrency

No multi-user concerns (single-user app). Edits are simple PUTs to a tRPC procedure; last write wins.

---

## tRPC additions

```ts
item.updateConcept({ itemId, conceptJson }) → ContentItem
item.resetConcept({ itemId }) → ContentItem        // copies aiConceptJson → conceptJson
item.estimateCost({ itemId }) → { usd: number }    // recompute after edits
```

The selection table calls `item.estimateCost` on every save to refresh the per-row cost (e.g. switching audio mode to voiceover bumps the price by `REEL_VOICEOVER_ADDON`).

---

## Generation becomes deterministic

`runItemJob` no longer needs an LLM loop. It's:

```ts
async function runItemJob(itemId: string) {
  const item = await db.contentItem.findUnique({ where: { id: itemId }, include: { characters: true } });
  const c = item.conceptJson;

  switch (item.type) {
    case "REEL":
      await runReelPipeline(item, c);   // submit_seedance + tts + mux
      break;
    case "CAROUSEL_CANVA":
      await runCanvaPipeline(item, c);  // resolve image prompts → render slides
      break;
    case "CAROUSEL_TEXT_OVERLAY":
      await runOverlayPipeline(item, c); // generate_image → place_text_on_image
      break;
  }
}
```

Each pipeline is a few sequential tool calls. The orchestrator's LLM loop ([02-orchestrator.md](02-orchestrator.md)) is **only used during `runBriefJob`**. `runItemJob` doesn't call the LLM at all in the happy path.

### When the LLM still gets invoked at item time

Two narrow escape hatches:

1. **Slide image regeneration on user request** — if you don't like a generated photo on a Canva slide, the UI lets you click "Regenerate this image with a tweak" → that hits a small LLM call to refine the prompt.
2. **Text placement retry** — if `place_text_on_image` returns a low-confidence region (high `scoreAtRegion`), the orchestrator can ask an LLM to suggest a shorter overlay text or different font size, then retry. Capped at 2 retries.

Otherwise, no LLM in the generation hot path. Cost and latency are bounded by the external image/video API calls.

---

## Data model adds

```prisma
model ContentItem {
  // existing
  aiConceptJson   Json    // original LLM output, frozen
  conceptJson     Json    // current (user-editable) version
  conceptRevision Int     @default(1)   // bumps on every save
  // ...
}
```

`aiConceptJson` is set once at brief time and never overwritten. `conceptJson` is mutable and reflects user edits. The two are kept side-by-side so reset is a single `UPDATE`.

---

## Why this matters

- **The prompt is no longer invisible.** You can read exactly what Seedance is about to be asked. If it sounds wrong, you fix it before paying.
- **Cost is predictable.** No second LLM round adds tokens at generation. Estimate matches actual.
- **Iteration is fast.** Want a different camera angle? Change a dropdown, regenerate. No prompt-engineering needed.
- **Prompts (the `.md` seeds) and concepts (the per-item scripts) are both editable, at the right granularity.** Prompts shape the *system*; concepts shape one *piece of content*.

---

## See also
- [02-orchestrator.md](02-orchestrator.md) — `runBriefJob` does more work; `runItemJob` becomes deterministic
- [04-seedance.md](04-seedance.md) — the `cameraPerspective` schema that the script must populate
- [07-prompts.md](07-prompts.md) — `director-brief.md` includes the "fully elaborated output" requirement
- [09-web-app.md](09-web-app.md) — the per-row edit drawer on the selection table
- [10-cost-and-pricing.md](10-cost-and-pricing.md) — brief-planning cost goes up; `runItemJob` cost goes down
