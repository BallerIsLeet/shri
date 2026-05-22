# 14 — Characters (Consistency Across Ads)

**Purpose:** Document the optional character system — onboarding, AI-generated reference images, the multi-view character sheet, and how characters get pulled into carousels and reels for visual consistency.

---

## Why characters

If your ads feature the same mascot, founder avatar, or stylized customer across multiple posts, you want them to look the same — same face, same outfit, same vibe — every time. Stock image gen doesn't naturally do this. Two `generate_image` calls with the same prompt produce two different-looking people.

The character system solves this by:

1. Letting you (or the AI, via chat) define a character once.
2. Generating a canonical reference image from that definition.
3. Generating multiple **views** (front, side, three-quarter, back, expression variants) using the base as a reference.
4. **Merging the views into one JPEG character sheet** — both for your eyes and as a single high-density reference the LLM can pass to subsequent image-gen calls.
5. Pulling characters into content-item generation automatically whenever the brief references them.

Characters are **optional**. A project can have zero characters and the rest of the studio works unchanged. A project can have multiple characters; the brief LLM picks which (if any) to use per content item.

---

## Onboarding

Two modes — toggle in the UI:

### Form mode

```
Name:           [_______________________________________]
Type:           ( ) Human    ( ) Animal    ( ) Other / Stylized
Species:        [_______________________________________]   (only if Animal/Other)
Age:            [_______]    (free text — "28", "puppy", "ancient")
Gender:         [_______]    (free text — leave blank if N/A)
Visual style:   [_______________________________________]
  e.g. "soft pastel watercolor", "low-poly 3D", "minimal line drawing"
Description:    [textarea — 2-4 sentences describing appearance]
                e.g. "warm brown skin, curly hair pulled back, round
                glasses, oversized linen shirt; relaxed posture, smiles
                easily, often holds a mug"
                                                          [ Save & generate ]
```

### Chat mode

A side-panel chat widget. You type "I want a friendly fox mascot for a productivity app" — the LLM asks follow-up questions ("indoor or outdoor vibe? cartoony or realistic? props?") and proposes a description. Each turn refines. When you're satisfied, click "Use this description" and the LLM-built description is saved exactly as if you'd typed it in form mode.

Chat history is persisted on the Character row (`chatJson`) so you can return and continue refining later.

---

## Generation pipeline

```mermaid
flowchart TD
    A[Onboarding done] --> B[generate_character_base]
    B -->|gpt-image-1 text-to-image| C[base.png<br/>1024x1024]
    C --> D[generate_character_views]
    D -->|N parallel gpt-image-1 calls<br/>each with base.png as reference| E[views/<br/>front.png, side.png,<br/>three-quarter.png, back.png,<br/>smile.png, neutral.png]
    E --> F[merge_character_sheet]
    F -->|Sharp composite + labels via Satori| G[sheet.jpg<br/>3072x2048, then downscaled to 1500x1000]
    G --> H[Character row updated:<br/>baseR2Key, sheetR2Key, views[]]
    H --> I[Ready for use in content gen]
```

### `generate_character_base`

```ts
input: { projectSlug, characterId };
output: { r2Key, url };  // base.png
```

Builds a prompt from the Character row (name, species, age, gender, description, visual style) and calls `openai.images.generate` with `gpt-image-1`, `size: "1024x1024"`. Uploads to `projects/{slug}/characters/{id}/base.png`.

### `generate_character_views`

```ts
input: {
  projectSlug,
  characterId,
  baseR2Key,
  poses: string[];   // default: ["front", "three-quarter", "side", "back", "smile", "neutral"]
};
output: {
  views: Array<{ pose: string; r2Key: string; url: string }>;
};
```

For each requested pose, runs an `openai.images.edit` call (or `images.generate` with the base image passed as a reference, depending on what gpt-image-1 supports at the time) with a prompt like: "Same character as the reference image. Show them in {pose} pose. Same outfit, same lighting, same style."

Calls fan out in parallel. Each view goes to `projects/{slug}/characters/{id}/views/{pose}.png`.

### `merge_character_sheet`

```ts
input: {
  characterId;
  views: Array<{ pose: string; r2Key: string; order: number }>;
  layout?: "grid_3x2" | "grid_2x3" | "horizontal";  // default grid_3x2
};
output: { sheetR2Key: string; url: string };
```

Pipeline inside `merge_character_sheet`:

1. Download all view PNGs from R2 into Buffers.
2. For each view, render a labeled tile (image + pose label below) via Sharp's composite, ending with a 1024×1100 tile (1024 image + 76px label strip).
3. Lay tiles out in the chosen grid using Sharp's `composite` API.
4. Encode as JPEG quality 85, downscale if total exceeds 1500×1000.
5. Upload to `projects/{slug}/characters/{id}/sheet.jpg`.

A 6-view 3×2 sheet ends up ~250 KB JPEG — small enough to pass as a reference in subsequent image-gen calls, large enough to remain detailed.

---

## Storage

```prisma
model Character {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name        String
  species     String              // "human", "fox", "robot", etc.
  age         String?
  gender      String?
  visualStyle String?             // free text
  description String              // canonical long-form
  basisMode   CharacterBasisMode  // FORM | CHAT
  chatJson    Json?               // chat history if basisMode=CHAT
  baseR2Key   String?
  sheetR2Key  String?
  status      CharacterStatus     // DRAFTING | GENERATING | READY | FAILED
  views       CharacterView[]
  contentItems ContentItemCharacter[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model CharacterView {
  id          String  @id @default(cuid())
  characterId String
  character   Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  pose        String   // "front", "side", "three-quarter", "back", "smile", "neutral", ...
  r2Key       String
  order       Int      // position in the sheet
}

// Join table — a content item can feature multiple characters
model ContentItemCharacter {
  contentItemId String
  characterId   String
  role          String?  // optional — "protagonist", "background", "narrator"
  @@id([contentItemId, characterId])
}

enum CharacterBasisMode { FORM CHAT }
enum CharacterStatus    { DRAFTING GENERATING READY FAILED }
```

R2 layout for a character:

```
projects/{slug}/characters/{characterId}/
├── base.png                 ← canonical reference, 1024x1024
├── sheet.jpg                ← merged labeled sheet, ~1500x1000
└── views/
    ├── front.png
    ├── three-quarter.png
    ├── side.png
    ├── back.png
    ├── smile.png
    └── neutral.png
```

---

## Editing a character

The character detail page (`/projects/[slug]/characters/[id]`) shows:

- The merged sheet, large.
- A side panel with: name, species, age, gender, visual style, description (all editable).
- A "Regenerate base" button (re-runs `generate_character_base` with current description).
- A "Regenerate views" button (re-runs `generate_character_views`).
- A "Regenerate sheet" button (re-merges from existing views — cheap).
- A view grid where you can click any tile to: regenerate just that pose, swap in an uploaded image, or delete the pose.
- If onboarded via chat, a "Continue chat" button to keep refining the description.

Editing the description and saving without regenerating is allowed — it shifts the canonical description for future content generation without spending image-gen credits.

---

## Using characters in content generation

When the brief LLM proposes a content item, it can optionally include `characterIds` in `ContentItem.conceptJson`. The orchestrator, during `runItemJob`, passes the character context to image-gen tools:

```ts
// inside generate_image (carousel slide path)
const characters = await loadCharacters(item.characterIds);
const referenceImages = characters.map(c => c.sheetR2Key);   // pass sheets as visual references
const characterContext = characters
  .map(c => `Character "${c.name}" (${c.species}, ${c.age ?? "?"}): ${c.description}`)
  .join("\n\n");

const fullPrompt = `${characterContext}\n\nScene: ${slideSpec.prompt}\n\nKeep characters visually consistent with the reference sheets.`;

await openai.images.edit({
  model: env.OPENAI_IMAGE_MODEL,
  image: await fetchAsFile(referenceImages),   // multi-image reference
  prompt: fullPrompt,
});
```

For Seedance reels, the character sheet (or a specific view PNG) is passed via `submit_seedance_job`'s `references[]` array — Seedance 2.0's omni-reference system anchors the reel to that character's appearance:

```ts
await submit_seedance_job({
  prompt: "@Image1 walks left through the office, glances at the camera, then turns back to her laptop. 0-3s establish, 3-8s the glance.",
  cameraPerspective: { framing: "medium", angle: "eye_level", movement: "tracking", lens: "normal", focus: "shallow_dof" },
  references: [
    { r2Key: character.sheetR2Key, role: "the character" },
    // optional environment / product refs follow as @Image2, @Image3, …
  ],
  generateAudio: true,
  ratio: "9:16",
});
```

The handler appends `@Image1 as the character` to the composed prompt automatically (see [04-seedance.md](04-seedance.md)) — but the freeform `prompt` body must still mention `@Image1` explicitly, or the tool rejects the call. For most scenes the sheet is the right input (more visual coverage); use a specific `CharacterView` PNG only when you want the reel to open from a specific pose (`role: "the first frame"`).

The LLM, when assembling the brief, gets `list_project_characters` results in context and decides per content item whether a character belongs. No character → unchanged behavior.

---

## The two new MCP tools (and existing tool extensions)

| Tool | Purpose |
|---|---|
| `list_project_characters` | Returns all Characters + their sheets for a project. The LLM uses this to decide who's available. |
| `chat_design_character` | Stateful chat helper: takes prior turns + new user message, returns LLM reply + (optional) suggested description string. |
| `generate_character_base` | Text → base.png. |
| `generate_character_views` | base.png + poses[] → N view PNGs. |
| `merge_character_sheet` | view PNGs → labeled JPEG sheet. |
| `generate_image` (extended) | Now accepts optional `characterIds` array; loads sheets, prepends character context, calls `images.edit` instead of `images.generate` when refs are present. |
| `submit_seedance_job` (extended) | Accepts an optional `references[]` array (`{r2Key, role}`, up to 9). Character sheets slot in as `{r2Key: c.sheetR2Key, role: "the character"}`; specific poses can slot in as `{role: "the first frame"}`. Mapped positionally to `@ImageN` tags in the prompt. |

All MCP-exposed. From Claude Code:

```
> use shri.chat_design_character with projectSlug "my-app", message "design me a friendly fox mascot"
< (LLM proposes attributes, asks questions)

> use shri.generate_character_base with projectSlug "my-app", characterId "<id>"
< (base.png URL)

> use shri.generate_character_views with projectSlug "my-app", characterId "<id>", baseR2Key "..."
< (six view PNG URLs)

> use shri.merge_character_sheet with characterId "<id>", views [...]
< (sheet.jpg URL)
```

---

## See also
- [03-tools.md](03-tools.md) — full tool surface including the character tools
- [08-storage-and-data.md](08-storage-and-data.md) — Character / CharacterView / ContentItemCharacter schema
- [09-web-app.md](09-web-app.md) — `/projects/[slug]/characters` routes
- [15-theme-story.md](15-theme-story.md) — the other creative-direction layer
