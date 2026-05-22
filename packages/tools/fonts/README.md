# Bundled fonts for Satori (carousel + text-overlay rendering)

Satori requires fonts to be loaded as `Buffer`s — no system-font fallback. Four
TTF files MUST live in this directory before `render_jsx_carousel` or
`place_text_on_image` can run in production:

```
fonts/
├── Inter-Regular.ttf          (Inter — body)
├── Inter-Bold.ttf             (Inter — bold body / UI)
├── DMSerifDisplay-Regular.ttf (DM Serif Display — headlines)
└── JetBrainsMono-Regular.ttf  (JetBrains Mono — code / numbers)
```

## Procurement

All four are SIL Open Font License (OFL). Download the latest release TTFs and
drop them in:

- **Inter Regular + Bold**: https://github.com/rsms/inter/releases (use the
  static `Inter-Regular.ttf` and `Inter-Bold.ttf` from the release zip's
  `Inter Desktop` folder, NOT the variable font).
- **DM Serif Display**: https://fonts.google.com/specimen/DM+Serif+Display
  (download family → take `DMSerifDisplay-Regular.ttf`).
- **JetBrains Mono Regular**: https://github.com/JetBrains/JetBrainsMono/releases
  (the `ttf/JetBrainsMono-Regular.ttf` from the latest release zip).

Each TTF stays under ~400KB; the four together fit inside a Railway
container image without bloat.

## License attribution

OFL requires the license to ship alongside the fonts. Drop the `OFL.txt` for
each family into this directory next to its TTF(s). The font filename and
attribution requirements are listed in each project's `LICENSE` file.

## Why not load fonts from disk lazily / from a CDN?

Cold-start fragility. Satori is called per-slide; reading + parsing TTFs on
every call is wasteful, and a CDN dependency introduces a network failure mode
in our otherwise self-contained render path. `loadFonts()` reads all four once
at module load, caches the buffers, and we're done.

## What if a font is missing?

`loadFonts()` throws with a clear message naming the missing file. The render
tool surfaces that as a tool error so the caller sees exactly which TTF to drop
in. Tests that need real Satori rendering use `loadFontsOrSkip()` (declared in
the carousel test file) to skip cleanly when fonts aren't installed locally.
