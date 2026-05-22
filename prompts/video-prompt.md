# Video prompt — how to write Seedance prompts

Used by `runItemJob` when composing the BytePlus Seedance request body. Read alongside [docs/04-seedance.md](../docs/04-seedance.md) for the @-image-reference convention and the camera-perspective schema.

## The 6D formula (Seedance 2.0's own guidance)

Every prompt covers six dimensions, even briefly:

1. **Subject** — who or what is in frame. Reference characters and props by name; tag image references as `@Image1`, `@Image2`, …
2. **Action** — what happens across the clip. Describe in beats: "0-3s establishes the room, 3-6s the hand reaches in, 6-8s the product lifts into frame."
3. **Scene / environment** — the setting around the subject. Recap from the `environment` block.
4. **Camera** — composed automatically from the structured `cameraPerspective` schema. You write the rest of the prompt; the handler prepends the camera sentence.
5. **Lighting** — concrete cues: "warm late-afternoon sidelight," "soft overcast, even shadows," "low-key practical lamps."
6. **Time / rhythm** — beats per second, pace, when things land.

## Anatomy of a good prompt

```
@Image1 as the character. @Image2 as the environment.

[camera sentence — composed by handler]

A late-afternoon kitchen, soft warm light through linen curtains.
@Image1 sits at the wooden table, hands wrapped around a ceramic
mug. 0-2s wide establishing the room; 2-5s slow dolly toward the
mug; 5-8s the steam catches the light and her face lifts into a
small smile.
```

## TO PERSONALIZE

- The visual register the product expects (clean B2B → static + dolly-in, normal lens, deep DoF; consumer playful → handheld + warm grade).
- Two or three signature shot patterns to lean on across reels for consistency.
- The product's own visual cues (UI screen recording → frame as a phone in hand; physical product → studio close-up with seamless backdrop).

## Always include

- Every passed `@ImageN` reference mentioned in the prompt body (the handler rejects the call otherwise).
- An environment recap for multi-scene reels so every scene shares the world.
- Action described in time-coded beats covering the full `durationS`.
- Lighting + mood cues — Seedance picks these up strongly.

## What never to do

- Never write negative prompts. Seedance ignores them. Use positive constraints ("warm tones, soft daylight") not negative ones ("no harsh shadows").
- Never reference an image that isn't in `references[]` — the prompt-tag check rejects it.
- Never pass extra references "just in case" — each one dilutes attention. Pass only what the shot needs.
- Never describe sound — that's the `audioMode` decision elsewhere. Even in `audioMode: "seedance"` the audio reads the scene, not the prompt.
- Never invent characters or props not in the brief; the brief LLM populates `characterIds` and shot context. Honor that.

## Camera-sentence template (for reference)

The handler composes:

```
{framing} shot, {angle}. {movement} camera, {lens} lens, {focus}.
```

So a `medium / eye_level / dolly_in / normal / shallow_dof` becomes:

```
medium shot, eye level. dolly in camera, normal lens, shallow dof.
```

Always state what kind of shot you want by setting the structured fields. Leaving them to defaults produces flat, generic clips.
