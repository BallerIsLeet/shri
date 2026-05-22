# 15 — Theme & Story

**Purpose:** Document the per-project theme/story layer that gives every content item a shared creative direction — the world, mood, palette, narrative arc — without rewriting prompts per item.

---

## Why this is its own thing

Per-project prompts already shape voice and structure. But voice ≠ story. You might want:

- Voice: "warm, direct, no jargon."
- Story: "An indie productivity app that turns chaos into a satisfying garden. Each new task is a seed; finished tasks bloom. Setting: warm domestic interiors, cozy mornings."

The voice belongs in `director-brief.md`. The story belongs somewhere a separate person could write — a creative brief that the marketing director hands to the designer. That's `theme-story.md`.

Theme/story is **optional**. A project with no theme gets generic visuals chosen item-by-item. A project with a theme gets consistent worldbuilding across every reel and carousel.

---

## The seventh seed template

Adding theme/story brings the seed-template count from six to **seven**:

```
prompts/
├── director-brief.md
├── carousel-plan.md
├── video-plan.md
├── image-caption.md
├── text-overlay-copy.md
├── video-prompt.md
└── theme-story.md            ← new
```

And the allowlist in `packages/prompts-fs/` expands accordingly. Otherwise the lifecycle is identical to the other six files — see [07-prompts.md](07-prompts.md). Default in `prompts/`, personalized into `prompts-projects/{slug}/` on project creation by `generate_project_prompts`, editable in the UI.

---

## What goes in `theme-story.md`

A loose template:

```markdown
# Theme & story

## Setting
Where do these ads take place? Time of day, kind of space, weather.

## Mood
Two or three adjectives. (Warm + nostalgic. Sharp + caffeinated. Calm + spacious.)

## Visual palette
- Primary colors
- Texture / lighting cues
- What to avoid (e.g. "no neon, no hard shadows")

## Story arc
The underlying narrative every ad nudges forward. Often "before / after" or "ordinary → magical."

## Recurring motifs
Small objects, gestures, sounds that should show up across multiple pieces (mug, sticky notes, a kept-tidy desk).

## Tone of voice (cross-link)
Pulls from `director-brief.md` — don't restate, link.

## What to never do
Hard guardrails — "no people scrolling on phones," "never use red," "no generic stock-photo vibes."
```

The personalized version of this file (in `prompts-projects/{slug}/`) is what the brief LLM and the image-gen tools read at job time. The orchestrator concatenates `theme-story.md` into every system prompt for visual content (carousels + reels), so every shot gets the same world.

---

## Where it shows up in the UI

`/projects/[slug]/theme` — a single-page editor. Same `@uiw/react-md-editor` component as the other prompts page, but dedicated to the theme file with a wider editor and a help sidebar showing the template above.

A summary card on the project dashboard:

```
┌──────────────────────────────────────────────────────────────┐
│  Theme                                                       │
│                                                              │
│  Mood: warm, nostalgic, slightly playful                     │
│  Setting: cozy domestic interiors, late afternoon light      │
│  Palette: muted earth + soft cream + occasional sage         │
│  [ Edit theme ]                                              │
└──────────────────────────────────────────────────────────────┘
```

The summary card values are derived by parsing the `## Setting`, `## Mood`, `## Visual palette` headings — no separate fields in the DB. Edit the markdown, the card updates.

---

## How theme reaches the LLM

At job time, the orchestrator's system prompt for visual jobs is composed as:

```
[director-brief.md]
[theme-story.md]                ← new, when present
[carousel-plan.md | video-plan.md]
[image-caption.md | text-overlay-copy.md | video-prompt.md]
```

Brief generation (`runBriefJob`) reads all of the above so the proposed items already reflect the theme. Item generation (`runItemJob`) re-reads at the start of each item so manual theme tweaks take effect immediately.

For image-gen tool calls specifically, the theme's palette + setting + motif sections get appended to every prompt:

```ts
// inside generate_image
const themeContext = await readProjectPrompt(slug, "theme-story.md");
const palette = extractSection(themeContext, "Visual palette");
const setting = extractSection(themeContext, "Setting");

const fullPrompt = `${userPrompt}\n\nSetting: ${setting}\nPalette: ${palette}`;
```

Section extraction is a regex over `## Heading` blocks. If a section is missing, it's just omitted — no error.

---

## Interaction with characters

Theme defines the world. Characters live in it. When both are present, the image-gen prompt is composed as:

```
<character context from sheet+description>

<scene/slide prompt from LLM>

Setting: <from theme>
Palette: <from theme>
Motifs: <from theme>
```

The character sheet (visual reference) + the theme description (textual context) combine to give gpt-image-1 enough constraints to produce a coherent shot every time.

---

## What it does *not* do

- It's not a fonts/styles registry — Satori font selection still happens via the slide layer schema.
- It's not branded-asset management — logos still live in Assets.
- It's not a music library — silent video items remain silent.

Keep theme prose-y and prompt-shaped. The structured stuff lives in `Project` columns and `Asset` rows.

---

## See also
- [07-prompts.md](07-prompts.md) — the seed-template system theme/story plugs into
- [14-characters.md](14-characters.md) — the other creative-direction layer
- [02-orchestrator.md](02-orchestrator.md) — how `theme-story.md` gets composed into the system prompt
- [13-crawling-and-prompt-gen.md](13-crawling-and-prompt-gen.md) — `theme-story.md` is also personalized at project creation
