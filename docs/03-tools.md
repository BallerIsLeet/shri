# 03 — Tools

**Purpose:** Document the shared tool surface — the single source of truth for everything the system can do — and explain how one descriptor table feeds both OpenAI function-calling and the MCP server.

---

## Where the tools live

```
packages/tools/
├── index.ts                   ← exports `toolDescriptors`, `tools` map
├── descriptors.ts             ← name → zod schema → openai schema → mcp schema
├── generateImage.ts
├── renderJsxCarousel.ts
├── placeTextOnImage.ts
├── submitSeedance.ts
├── pollSeedance.ts
├── generateTts.ts
├── muxAudio.ts
├── listProjectAssets.ts
├── saveContentOutput.ts
├── readProjectPrompt.ts
├── writeProjectPrompt.ts
├── estimateCost.ts
└── pricing.ts                 ← constants only
```

Every tool exports a function with a single object argument and returns a typed result. No globals. Zero state across calls beyond what's persisted in DB or R2.

---

## The descriptor pattern

A single `ToolDescriptor` per tool is the source of truth:

```ts
// packages/tools/descriptors.ts (shape)
import { z } from "zod";
import { aiClient } from "@shri/ai";

export type ToolDescriptor<I = unknown, O = unknown> = {
  name: string;                       // snake_case, used by LLM + MCP
  description: string;                // shown to the LLM
  input: z.ZodType<I>;                // validates LLM arguments
  output: z.ZodType<O>;
  handler: (args: I, ctx: ToolCtx) => Promise<O>;
};

export const generateImageDescriptor: ToolDescriptor<...> = {
  name: "generate_image",
  description: "Generate an image and upload to R2.",
  input: z.object({
    prompt: z.string(),
    size: z.enum(["1024x1024","1024x1792","1792x1024"]).default("1024x1024"),
    projectSlug: z.string(),
  }),
  output: z.object({ r2Key: z.string(), url: z.string() }),
  handler: async ({ prompt, size, projectSlug }, ctx) => {
    const { buffers } = await aiClient.image.generate({ prompt, size });
    const key = `projects/${projectSlug}/outputs/${ctx.itemId}/${nanoid()}.png`;
    await storage.putObject(key, buffers[0], "image/png");
    return { r2Key: key, url: await storage.signedReadUrl(key) };
  },
};
```

The tool never knows what provider is behind `aiClient.image.generate` — that's deliberate. See [18-ai-client.md](18-ai-client.md) for the abstraction.

`packages/tools/index.ts` re-exports these and provides two derivation helpers:

```ts
export const openAiTools = (descs: ToolDescriptor[]) =>
  descs.map(d => ({
    type: "function" as const,
    function: { name: d.name, description: d.description, parameters: zodToJsonSchema(d.input) },
  }));

export const mcpTools = (descs: ToolDescriptor[]) =>
  descs.map(d => ({ name: d.name, description: d.description, inputSchema: zodToJsonSchema(d.input) }));
```

The worker calls `openAiTools(toolDescriptors)`. The MCP server calls `mcpTools(toolDescriptors)`. They share the exact same definitions.

---

## The full tool surface

| Tool | Purpose | Side effects |
|---|---|---|
| `list_project_assets` | Returns assets + presigned read URLs for a project. The LLM uses this to "see" what the user uploaded. | None (DB read) |
| `crawl_product_site` | Fetches a product website, parses key pages, extracts a structured product profile (features, tagline, tone, audience). | Outbound HTTP, DB write |
| `generate_project_prompts` | LLM-transforms the seven seed templates in `prompts/` into personalized per-project prompts using description + highlights + (optional) crawl profile. | OpenAI call, FS write |
| `list_project_characters` | Returns all characters + their sheets for a project. LLM uses this to decide which to feature per content item. | DB read |
| `chat_design_character` | Stateful chat to design a character (turn-by-turn LLM helper). Returns reply + optional suggested description string. | OpenAI call, DB write (chat history) |
| `generate_character_base` | Text → 1024×1024 base.png reference via `gpt-image-1`. | OpenAI call, R2 write |
| `generate_character_views` | base.png + poses[] → N view PNGs in parallel via `gpt-image-1` edit/reference. | OpenAI call (×N), R2 write |
| `merge_character_sheet` | view PNGs → labeled JPEG character sheet via Sharp composite + Satori label tiles. | R2 read + write |
| `generate_image` | OpenAI `gpt-image-1` → PNG → R2. | OpenAI call, R2 write |
| `render_jsx_carousel` | Constrained JSON slide spec → Satori → resvg → N PNG slides → R2. | R2 write |
| `place_text_on_image` | OpenCV saliency + edge density → best (x,y,w,h) for text → composite via Satori → R2. | R2 read + write |
| `submit_seedance_job` | POSTs to BytePlus `/tasks`, persists `Job.seedanceTaskId`, returns immediately. **Requires a structured `cameraPerspective` object** (framing, angle, movement, lens, focus) that gets composed into the prompt. Accepts an optional `references[]` array (`{r2Key, role}`, up to 9) that maps positionally to `@Image1`/`@Image2`/… tags in the prompt; the handler presigns each R2 key at submit-time and validates that every passed reference is named in the prompt body — see [04-seedance.md](04-seedance.md). | Seedance call, DB write |
| `poll_seedance_job` | GETs task status; on success downloads MP4 to R2. | Seedance call, R2 write, DB update |
| `generate_tts` | OpenAI TTS → MP3 → R2. | OpenAI call, R2 write |
| `mux_audio` | ffmpeg: combine MP4 + MP3, or strip audio. | R2 read + write, ffmpeg local |
| `concat_videos` | ffmpeg concat (lossless for hard_cut/match_cut, xfade for dissolve/fade). Used only for multi-scene reels — see [17-director-scenes.md](17-director-scenes.md). | R2 read + write, ffmpeg local |
| `save_content_output` | Writes `ContentOutput` row + final caption. | DB write |
| `read_project_prompt` | Reads `prompts-projects/{slug}/{file}.md`. | FS read |
| `write_project_prompt` | Writes a per-project prompt file. | FS write |
| `estimate_cost` | Deterministic cost calc from a plan JSON. | None (pure) |

---

## Tool dependency graph

```
   At project setup
   ────────────────
   crawl_product_site ──► generate_project_prompts ──► write_project_prompt × 7

   At character onboarding (optional)
   ──────────────────────────────────
   chat_design_character (iterative) ──► generate_character_base
                                          │
                                          ▼
                                   generate_character_views
                                          │
                                          ▼
                                   merge_character_sheet

   At brief / item time
   ────────────────────
   list_project_characters ──┐
                             ▼
                    generate_image ──┐   (now accepts characterIds + theme context)
                                     ├──► render_jsx_carousel ──► save_content_output
                    list_assets ─────┘

                    list_assets ────► place_text_on_image ──► save_content_output

                    submit_seedance ──► poll_seedance ──┐    (submit takes references[]: character sheet, env, product, etc. — mapped to @ImageN tags)
                                                        ├──► mux_audio ──► save_content_output
                                          generate_tts ─┘

                    estimate_cost (used by runBriefJob)
                    read/write_project_prompt (used by MCP-only flows)
```

The LLM chooses paths through this graph based on the item type. The orchestrator never hardcodes which tools to call — it just provides the full set and trusts the model to pick.

---

## Error model

Tools throw on real errors (network failure, invalid input that passed Zod but failed downstream, R2 5xx). The orchestrator catches and returns the error to the LLM as `{ error: "<message>" }` JSON content. This lets the model react: regenerate with a different prompt, fall back to a different tool, etc.

What tools **do not** do:
- Retry internally. Retry policy is BullMQ's job at the Job level.
- Validate cross-tool invariants. The LLM owns sequencing.
- Mutate DB rows owned by other tools. Each tool's writes are scoped to its own concern.

---

## Adding a new tool

1. Create `packages/tools/myNewTool.ts` with a function + descriptor.
2. Export the descriptor from `packages/tools/descriptors.ts`.
3. Add it to the `toolDescriptors` array in `packages/tools/index.ts`.

Both the worker and the MCP server pick it up automatically. No changes needed in `apps/worker` or `apps/mcp`. See [12-extending.md](12-extending.md).

---

## See also
- [02-orchestrator.md](02-orchestrator.md) — how the LLM loop calls these tools
- [04-seedance.md](04-seedance.md) — `submit_seedance_job` + `poll_seedance_job` in depth
- [05-images-carousels.md](05-images-carousels.md) — `render_jsx_carousel` + `place_text_on_image` in depth
- [06-mcp-server.md](06-mcp-server.md) — how the MCP server exposes these tools
