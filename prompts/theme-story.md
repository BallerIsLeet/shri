# Theme & story

Optional but high-leverage. Defines the world every reel and carousel lives in — the setting, mood, palette, recurring motifs. Concatenated into every visual system prompt so each shot inherits the same creative direction.

## Setting

Where do these ads take place? Time of day, kind of space, weather.

> e.g. "Warm domestic interiors, mid-to-late afternoon. Mostly indoor — kitchens, home offices, reading nooks. Occasional outdoor scenes are soft-light park or balcony at golden hour."

## Mood

Two or three adjectives. The emotional register the audience should pick up before they parse any words.

> e.g. "Warm. Slightly nostalgic. Quietly optimistic."

## Visual palette

- **Primary colors.** 2-4 hex codes that anchor the look.
- **Texture / lighting cues.** "Soft overcast through windows. Wood grain visible. Linen, ceramics, paper."
- **What to avoid.** "No neon. No hard cold blue light. No high-contrast b&w."

## Story arc

The underlying narrative every ad nudges forward. Often "before / after" or "ordinary → magical."

> e.g. "Friction at the start, ease by the end. The product is the moment of unblock."

## Recurring motifs

Small objects, gestures, sounds that should show up across multiple pieces. Consistency beats novelty.

> e.g. "A ceramic mug. Sticky notes. A kept-tidy desk. The hand reaching into frame from off-camera."

## Tone of voice

Pulled from `director-brief.md`. Don't restate — link.

## What to never do

Hard guardrails. Specific.

> e.g. "No people scrolling on phones. No stock-photo handshakes. Never use red. No generic 'startup office' visuals."

## TO PERSONALIZE

When `generate_project_prompts` runs, replace the above placeholder values with product-specific direction. Sources of truth:

- The product description + highlights provided at project creation.
- The crawled site profile (`crawlJson.productProfile`) — especially `tone`, `targetAudience`, `inferredCategory`.
- The character roster if any are defined (palette and setting should not fight the character designs).

The file is markdown by convention so the UI can render it directly with `@uiw/react-md-editor`. The dashboard parses `## Setting`, `## Mood`, and `## Visual palette` headings for the summary card — keep those exact headings even when personalizing.
