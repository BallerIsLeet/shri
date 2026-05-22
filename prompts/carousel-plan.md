# Carousel plan — guidelines

Used by `runBriefJob` when proposing carousels and by `runItemJob` when generating them. Picks between the two carousel sub-types and shapes the slide structure.

## The two sub-types

| Sub-type | Pick when |
|---|---|
| `CAROUSEL_CANVA` | The idea benefits from layout, typography hierarchy, multiple layers per slide (background + photo + caption + accent). Most explainer carousels, "5 ways to X", before/after, feature tours. |
| `CAROUSEL_TEXT_OVERLAY` | The idea is one strong image per slide with a single line of overlay text. Screenshots of the product with a punchy caption. Stylized photography with a quote. |

Default to `CAROUSEL_CANVA` unless the slides are essentially "image + one line of text on top." Then go text-overlay.

## Slide structure

- **Slide 1 = the hook.** First two seconds of attention. Big type, no preamble.
- **Slides 2 to N-1 = the payoff.** Each one delivers a single beat. If you can't summarize a slide in five words, it's two slides.
- **Last slide = the CTA.** One ask. Not "follow + like + share + comment + DM." Pick one.

## TO PERSONALIZE

- The visual style this product's audience expects (clean Stripe-style typography? handwritten + photo? meme-native?).
- The 1-3 hook formulas that work for this audience (e.g. "the N-thing-they-didn't-realize," "what changes when X," "the version of X for people who Y").
- Any platform-specific quirks (Instagram caps swipe count, TikTok carousel format differs from Instagram, etc.).

## Slide count

- Sweet spot: **5-7 slides** for explainers, **3 slides** for hook+payoff+CTA punches.
- Hard ceiling: **10 slides**. Anything longer is a blog post; write that instead.

## Ratio

- Instagram feed / TikTok carousel: `4:5` or `1:1`.
- Stories / Reels-as-carousel placement: `9:16`.
- Twitter / X feed: `16:9` or `1:1`.

Match the ratio to the primary platform in `platform[]`.

## Always include

- A concrete `hook` line — the exact words on slide 1.
- A `caption` field with the ready-to-paste social copy (hook, value, CTA, hashtags if relevant).
- For `CAROUSEL_CANVA`: full slide `spec` per slide + `embeddedImagePrompts[]` for any image layers that need generation.
- For `CAROUSEL_TEXT_OVERLAY`: `basePrompt` (the underlying image) + `overlayText` (the line that sits on top) + `textStyle`.

## What never to do

- Never start a carousel with a question that the title already answers.
- Never use stock-photo people unless the brief explicitly calls for them.
- Never put more than ~12 words of overlay text on a single text-overlay slide. The eye won't read it.
