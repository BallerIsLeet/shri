# 12 — Extending

**Purpose:** Checklists for the four most common extensions: adding a tool, adding a content type, swapping the LLM provider, adding a font.

---

## Adding a new tool

Example: `generate_logo_variant` that takes an existing logo, asks GPT-image-1 to produce 4 stylistic variants, and uploads them all.

1. Create `packages/tools/generateLogoVariant.ts`:
   ```ts
   import { z } from "zod";
   import type { ToolDescriptor } from "./descriptors";

   export const generateLogoVariantDescriptor: ToolDescriptor<...> = {
     name: "generate_logo_variant",
     description: "Generate N stylistic variants of an existing logo image.",
     input: z.object({
       projectSlug: z.string(),
       sourceR2Key: z.string(),
       variantCount: z.number().min(1).max(8).default(4),
       style: z.enum(["monochrome", "gradient", "playful", "corporate"]),
     }),
     output: z.object({ variants: z.array(z.object({ r2Key: z.string(), url: z.string() })) }),
     handler: async ({ ... }, ctx) => { ... },
   };
   ```

2. Export from `packages/tools/descriptors.ts`:
   ```ts
   export { generateLogoVariantDescriptor } from "./generateLogoVariant";
   ```

3. Add to the `toolDescriptors` array in `packages/tools/index.ts`:
   ```ts
   export const toolDescriptors: ToolDescriptor[] = [
     // ... existing
     generateLogoVariantDescriptor,
   ];
   ```

4. (Optional) Mention it in the relevant `prompts/*.md` so the LLM knows when to reach for it.

That's it. The worker picks it up via `openAiTools(toolDescriptors)` and the MCP server picks it up via `mcpTools(toolDescriptors)`. No changes in `apps/worker` or `apps/mcp`.

**Verify:**
```bash
pnpm --filter @shri/mcp start
# in Claude Code:
> /mcp
# should now show generate_logo_variant in the tool list
```

---

## Adding a new content type

Example: a 3-second animated GIF banner.

1. Add the enum value in `packages/db/prisma/schema.prisma`:
   ```prisma
   enum ContentType {
     CAROUSEL_CANVA
     CAROUSEL_TEXT_OVERLAY
     REEL
     ANIMATED_GIF      // new
   }
   ```
   Run `pnpm db:migrate`.

2. Add a tool that produces the new artifact. For GIF: `generate_animated_gif` (could use FFmpeg + a sequence of Satori frames, or a Seedance "video to gif" path).

3. Update `packages/orchestrator/runItemJob.ts` to switch on the new type and choose the right tool chain.

4. Update `packages/tools/pricing.ts` with an estimation constant (see [10-cost-and-pricing.md](10-cost-and-pricing.md)).

5. Update `prompts/carousel-plan.md` (or create a new `prompts/animated-gif-plan.md`) so the LLM knows the new type exists and when to propose it. Don't forget to copy to existing project dirs:
   ```bash
   for d in prompts-projects/*/; do cp prompts/animated-gif-plan.md "$d"; done
   ```

6. UI: the selection table is already type-agnostic — it shows whatever `ContentItem.type` is in the DB. Item detail page might need a new preview component for GIFs.

---

## Swapping the LLM provider

Every AI call goes through `aiClient` (see [18-ai-client.md](18-ai-client.md)). The namespaces (`chat`, `image`, `tts`, future `vision`/`embeddings`) each read their own config tier from env, so you can split providers per method without touching tool code.

To switch chat from OpenAI to Claude via OpenRouter while keeping image + TTS on OpenAI:

```bash
# .env — set chat-specific overrides; image/tts keep using the shared defaults
OPENAI_CHAT_API_KEY=sk-or-v1-...
OPENAI_CHAT_BASE_URL=https://openrouter.ai/api/v1
OPENAI_CHAT_MODEL=anthropic/claude-opus-4
```

No code changes. Restart the worker.

To switch everything to a single multi-provider gateway like LiteLLM:

```bash
OPENAI_API_KEY=<litellm key>
OPENAI_BASE_URL=http://litellm.internal/v1
# per-method models stay set; per-method API overrides not needed
OPENAI_CHAT_MODEL=anthropic/claude-opus-4
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_TTS_MODEL=gpt-4o-mini-tts
```

Adding a new AI capability (vision, embeddings, transcription) means adding a new namespace to `packages/ai/` — see [18-ai-client.md](18-ai-client.md) for the four-step pattern.

---

## Adding a font

Satori needs explicit fonts. To add (for example) Playfair Display:

1. Drop the TTF into `packages/tools/fonts/PlayfairDisplay-Regular.ttf`.
2. Read it into a Buffer at startup in `packages/tools/renderJsxCarousel.ts`:
   ```ts
   const FONTS = [
     // existing
     { name: "Playfair", data: await fs.readFile(path.join(FONTS_DIR, "PlayfairDisplay-Regular.ttf")), weight: 400, style: "normal" },
   ];
   ```
3. Add to the enum in the layer schema (see [05-images-carousels.md](05-images-carousels.md)):
   ```ts
   font: z.enum(["Inter", "Inter-Bold", "DM-Serif", "JetBrains-Mono", "Playfair"]),
   ```
4. Mention it in `prompts/carousel-plan.md` so the LLM knows it's available.

---

## Removing a tool

Don't just delete the file — first audit usage:

```bash
grep -r 'tool_name' packages/ apps/ prompts/ prompts-projects/
```

Any LLM-facing mentions in prompts will keep the LLM trying to call the deleted tool, which will throw `unknown tool`. Remove prompt mentions first, deploy, then delete the code.

---

## Migrating to a worktree-style multi-user setup

Out of scope for v1, but if you ever go multi-user:

1. Add a `User` table; tie `Project` to a `userId`.
2. Replace basic auth with NextAuth / Clerk / WorkOS.
3. Scope every tRPC procedure to the current user via context.
4. R2 keys gain a `users/{userId}/` prefix.
5. `prompts-projects/` becomes `prompts-projects/{userId}/{slug}/`.

The orchestrator and tool layer are unaffected — they already pass `projectId` / `projectSlug` through every call, so adding userId to the resolution chain is mechanical.

---

## See also
- [03-tools.md](03-tools.md) — the descriptor pattern that makes tools pluggable
- [07-prompts.md](07-prompts.md) — how new tools/types get introduced to the LLM via prompts
- [11-deployment.md](11-deployment.md) — what to update in Railway env when swapping providers
