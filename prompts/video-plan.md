# Video plan — guidelines for 6-12 second reels

Used by `runBriefJob` (proposing reels) and `runItemJob` (generating them). Default is single-scene; multi-scene is opt-in.

## Structure (every reel)

- **First second = the hook.** The viewer decides to keep watching in this window. No fades in, no logo cards, no slow build.
- **By second 5 = the payoff lands.** Whatever the reel is "about" has happened or is unmistakably arriving.
- **Final beat = the close.** Either a button-press moment (the product reveal, the punchline frame) or a deliberate hold for caption-reading time.

Total length: **6-12 seconds.** Past 12s on a vertical reel and watch-through tanks.

## Single-scene vs multi-scene

**Single-scene is the default.** One Seedance call, one continuous shot. Use when the idea is one beat — a transformation, a reveal, a reaction, a vibe.

**Multi-scene (`scenes.length >= 2`) is opt-in.** Only propose when the content has a real narrative arc that one continuous shot can't carry:

- Before / after (two scenes, distinct settings or moments).
- Setup → punchline (the joke needs a cut).
- Three-beat micro-story (intro → escalation → payoff).

Stitching costs an extra ffmpeg step + each transition adds noise. Don't reach for it.

## Audio mode

Pick per reel and put in `conceptJson.audioMode`:

- `seedance` — Seedance generates ambient SFX + foley. Cheapest path. Good for vibe shots, lifestyle clips, ambient product reveals.
- `silent` — output is silent, flagged `needs_music`. Pick when the editor will add licensed music post-download.
- `voiceover` — Seedance produces silent video, OpenAI TTS speaks the hook, ffmpeg muxes. Pick for punchy hooks where the words carry it.

Default to `seedance` unless the hook is verbal-first.

## The Seedance prompt (per scene)

The `seedanceScript.prompt` must be cinematic, not descriptive. Seedance reads scene language:

- Reference each `@ImageN` reference by tag — every reference passed must be mentioned in the prompt body.
- Recap the `environment` (setting + time of day + mood) so each scene shares the world.
- Describe what's happening across the scene's duration in beats (e.g. "0-3s establish the desk, 3-6s the hand reaches the keyboard").
- No negative prompts — Seedance ignores them. Express constraints positively ("warm afternoon light" not "no harsh shadows").

The `cameraPerspective` is required and the tool composes it into the prompt. Make camera choices on purpose, not by default.

## TO PERSONALIZE

- The product's visual register (clean B2B → static + dolly-in; consumer playful → handheld + warm).
- Two or three signature shot patterns to lean on (e.g. "hand reaches into frame," "slow pan across desk to product").
- Any content the product itself can star in (UI screen recording → frame as a phone in hand; physical product → studio close-up).

## Always include

- `hook`, `durationS`, `audioMode`, `caption`.
- `environment` block with at minimum `setting`, `background`, `surroundings`, `timeOfDay`, `mood`.
- `scenes[]` with at least one scene; each scene has `seedanceScript.prompt`, full `cameraPerspective`, `durationS`.
- `voiceoverText` if `audioMode === "voiceover"`.

## What never to do

- Never propose a reel longer than 12s.
- Never leave `cameraPerspective` partial — all five sub-fields are required.
- Never describe the scene without recapping the environment if it's a multi-scene reel.
- Never reach for multi-scene when single-scene tells the same story.
