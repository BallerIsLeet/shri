# Text-overlay copy — short-form rules

Used by `runItemJob` for `CAROUSEL_TEXT_OVERLAY` items and by any reel/image step that puts text on a frame. Governs what to write, how long, what styles.

## The constraint

Overlay text competes with the image for attention. The image already carries 80% of the meaning. Text is the punctuation, not the paragraph.

## Length

- **6-12 words** per overlay line. Hard cap at 16.
- **One overlay block per image.** Two blocks = the eye can't pick a starting point.
- If you can't say it in 12 words, the image is the wrong image.

## Voice

- **Spoken, not written.** Read it aloud. If it sounds like a tweet, good. If it sounds like a press release, rewrite.
- **Specific subjects.** "The 4 a.m. you" beats "your morning self." Concrete > abstract.
- **No marketing voice.** No "discover," "unlock," "amazing," "level up."

## Type style

Specified in `textStyle`:

```ts
{
  font:     "Inter" | "Inter-Bold" | "DM-Serif" | "JetBrains-Mono";
  sizePx:   number;          // 48-160; default 96 for hero text, 64 for secondary
  color:    string;          // hex; check contrast against placement region
  weight?:  "regular" | "bold";
  align?:   "left" | "center" | "right";
  shadow?:  boolean;         // true when placement is on a busy/light region
}
```

Default to `Inter-Bold`, 96px, white with subtle shadow if image is anything other than a solid dark region. `placeTextOnImage` picks the placement region; the style only affects rendering.

## TO PERSONALIZE

- Brand fonts (substitute for the four defaults).
- Brand color palette (use 1-2 colors, never more on a single overlay).
- Whether the brand uses sentence case, Title Case, or ALL CAPS for hero text.

## Always include

- An `overlayText` field with the exact words.
- A `textStyle` object with font + sizePx + color at minimum.
- For multi-slide carousels: each slide's overlay text must work standalone (a viewer who only sees that slide should get a complete thought).

## What never to do

- Never put more than 12 words on a slide.
- Never use both an emoji and a punchline in the same overlay — pick one.
- Never use a font outside the four bundled options unless `textStyle.font` has been overridden at the project level.
- Never overlay text on a face or a primary product UI element; `placeTextOnImage` will route around them but write copy short enough to fit the routed region.
