// =============================================================================
// SERVER_INSTRUCTIONS — sent to MCP clients during `initialize` so the model
// knows HOW to use the tool surface, not just WHAT exists. Clients (including
// Claude Code) surface this string to the model.
//
// Source of truth: docs/06-mcp-server.md. Every convention below has a
// corresponding doc and (where load-bearing) tool-side enforcement.
//
// Do NOT inline this in src/index.ts — keeping it in its own file makes it
// independently testable (smoke test asserts presence + key contents on the
// server constructor options) and easy to update without touching wiring.
// =============================================================================

export const SERVER_INSTRUCTIONS = `Shri is a marketing content studio. The tools below let you generate carousels,
reels, and characters for a project. Use them to produce on-brand content that
matches the project's prompts, theme, and characters.

Every tool call MUST include \`projectSlug\` in the input arguments — it scopes
the call to a specific project and is used to load prompts, characters, theme,
and assets. If you don't know the slug, call \`list_project_assets\` with a
guess or ask the user before proceeding.

================================================================================
TOOL SURFACE (20 tools)
================================================================================

Project setup
  - list_project_assets        list uploaded icons/screenshots/refs (read-only)
  - crawl_product_site         fetch product website + extract productProfile
  - generate_project_prompts   LLM-rewrite the 7 seed prompts for this project

Characters
  - list_project_characters    list characters with presigned sheet URLs
  - chat_design_character      multi-turn LLM helper to design a character
  - generate_character_base    text -> 1024x1024 base.png reference
  - generate_character_views   base + poses[] -> N parallel view PNGs
  - merge_character_sheet      composite views -> single labeled sheet JPEG

Image / carousel
  - generate_image             gpt-image-1 -> R2; honors characterIds + theme
  - render_jsx_carousel        constrained slide spec -> Satori PNG slides
  - place_text_on_image        OpenCV saliency placement + text overlay

Video / audio
  - submit_seedance_job        submit a reel job to BytePlus (see camera rules)
  - poll_seedance_job          poll status, download MP4 to R2 on success
  - generate_tts               OpenAI TTS -> MP3 in R2
  - mux_audio                  ffmpeg combine MP4 + MP3 (or strip audio)
  - concat_videos              ffmpeg concat scenes with typed transition

Cost + outputs + prompts
  - estimate_cost              deterministic USD estimate for a batch plan
  - save_content_output        REQUIRED final step to publish to the UI
  - read_project_prompt        read one of the 7 allowlisted prompt files
  - write_project_prompt       atomically overwrite one of the 7 prompt files

================================================================================
PROJECT SETUP ORDERING (do this first for a fresh project)
================================================================================

For a NEW project, run in this exact order:

  1. crawl_product_site         (if a website URL is available)
  2. generate_project_prompts   (uses the crawl + the project description)
  3. Optional character flow, only if the project benefits from a recurring
     human/mascot face on camera:
       a. chat_design_character        chat to converge on a description
       b. generate_character_base      text -> base.png
       c. generate_character_views     base + poses -> N view PNGs
       d. merge_character_sheet        composite into the labeled sheet JPEG
  4. Then start producing content (images, carousels, reels).

The seven per-project prompts live in prompts-projects/{slug}/ and ARE
user-editable. Use read_project_prompt / write_project_prompt to inspect or
adjust them; never bake project-specific copy into your own outputs.

================================================================================
VIDEO GENERATION (submit_seedance_job) — DIRECTOR'S PERSPECTIVE
================================================================================

Think like a director, not a prompt engineer. Every reel concept must include:

  1. An ENVIRONMENT (the set):
       - setting, background, surroundings
       - timeOfDay, mood, optional palette hint
     The environment is shared across every scene in the reel.

  2. A SCENE TYPE that flavors the tone:
       dramatic | comedic | ambient | suspenseful | energetic |
       intimate | epic | documentary

  3. CAMERA PERSPECTIVE — REQUIRED, all five sub-fields, every call:
       - framing:   extreme_wide | wide | medium | close_up | extreme_close_up
       - angle:     low | eye_level | high | birds_eye | dutch
       - movement:  static | pan | tilt | dolly_in | dolly_out | tracking |
                    handheld | crane
       - lens:      wide_angle | normal | telephoto | macro
       - focus:     shallow_dof | deep_dof | rack_focus

The tool's input schema REJECTS calls missing any cameraPerspective sub-field.
The handler then weaves the camera choice into the BytePlus prompt for you —
do NOT duplicate the camera language in your freeform prompt body.

The 6D formula
--------------
Seedance 2.0's own guide recommends a 6-dimension prompt:
  Subject -> Action -> Scene -> Camera -> Lighting -> Time/rhythm.
Camera is handled by the structured field above; the rest belong in the
freeform prompt. Keep prompts to 1-3 sentences. Express constraints positively
("warm tones, soft daylight") — Seedance ignores negative prompts.

Reference images (@ImageN convention)
-------------------------------------
Pass reference images via the references[] array. Each entry is
  { r2Key, role }
They map positionally to @Image1, @Image2, ... in the prompt text. Roles are
free-form natural language (e.g. "the character", "the environment",
"the first frame", "the product").

EVERY reference you pass MUST be mentioned in the freeform prompt body by its
@ImageN tag. The tool rejects the call otherwise. Unnamed references are
ignored or misinterpreted by Seedance.

Pass the MINIMUM set of references the shot actually needs. Do not include
every character the project defines, every uploaded asset, or "just in case"
environment refs. Each extra reference dilutes Seedance's attention, costs
tokens against the 9-image cap, and slows server-side fetch. Rules of thumb:
  - Close-ups of a single character: pass that character's sheet only.
  - Wide / lifestyle shots that require a specific location look:
    pass character + environment.
  - Product-reveal shots where the product is the subject: pass the
    product reference, not the character (unless they appear).
  - A shot driven entirely by the prompt's description (no specific
    real-world thing to lock to): pass NO references.

If you can't articulate what role a reference plays in this specific shot,
leave it out. Max 9 image references per job.

Example
-------
  references: [
    { r2Key: "projects/my-app/characters/abc/sheet.jpg", role: "the character" },
    { r2Key: "projects/my-app/uploads/desk.jpg",         role: "the environment" }
  ]

  prompt:
  "@Image1 sits at @Image2 in late-afternoon golden light. Mood: tired,
   hopeful. Foreground: sticky notes piled around a closed laptop. She
   looks up from the laptop and smiles. 0-3s establish the desk and
   light, 3-8s she lifts her gaze."

The handler will prepend "@Image1 as the character, @Image2 as the
environment." and the structured camera sentence automatically — do
not duplicate them in your prompt body.

Reels are 6-12 seconds. Hook visual lands in the first 1.5 seconds.
Choose an audio mode explicitly: "seedance" | "silent" | "voiceover".

================================================================================
MULTI-SCENE REELS (optional — default to single-scene)
================================================================================

SINGLE-SCENE IS THE DEFAULT. Only switch to multi-scene (scenes.length >= 2)
when the content has a GENUINE arc:
  - before/after
  - setup -> conflict -> payoff
  - montage across distinct contexts

When using multi-scene:

  - Write the ENVIRONMENT once at the top — it's shared across scenes.
  - In EVERY scene's prompt, recap the environment ("SAME DESK, SAME
    LIGHT, ...") because Seedance has no memory across scenes.
  - Choose a transition between scenes (typed enums, not free text):
      hard_cut | match_cut | dissolve | whip_pan | fade_to_black
  - Multi-scene reels fan out parallel submit_seedance_job calls and
    stitch the results with concat_videos when all are done.

================================================================================
IMAGE GENERATION (generate_image, render_jsx_carousel)
================================================================================

When the project has Characters, pass characterIds — generate_image loads the
character sheet(s) as visual references and keeps faces + outfits consistent
across the batch. Look up the available character ids with
list_project_characters.

When the project has a theme-story.md, the tool prepends setting + palette to
your prompt AUTOMATICALLY; do not duplicate that information in your prompt
body or the model will double-bias.

For multi-slide carousels, prefer render_jsx_carousel (constrained slide spec)
or place_text_on_image (text overlay on a real screenshot) over hand-rolling
generate_image per slide — both produce more consistent visual identity.

================================================================================
COST-AWARENESS
================================================================================

Image and video calls cost real money. Before generating a batch:

  - Call estimate_cost on the plan first. Surface the estimate to the user
    when running in interactive mode.
  - Prefer text-only briefs / outlines first; only escalate to image + video
    generation once the user has approved the concept.
  - For a quick iteration on a reel concept, generate ONE reel with a single
    cameraPerspective choice before fanning out a batch. Reels at $0.50/sec
    are the most expensive primitive.
  - For carousels, render_jsx_carousel (Satori, near-free) is much cheaper
    than per-slide generate_image; pick that when the design tolerates it.

================================================================================
OUTPUT PERSISTENCE
================================================================================

Always finish a content generation with save_content_output — the asset in
R2 is invisible to the web UI until the DB row exists. The save call requires
the item's r2Key (the asset you just wrote) plus optional thumbR2Key, caption,
and freeform meta. Skipping it produces a dangling R2 object that no one
will ever see.
`;
