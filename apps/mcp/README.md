# @shri/mcp

MCP stdio server that exposes the `@shri/tools` surface so Claude Code (or any
MCP client) can drive the Shri content studio interactively.

See [`docs/06-mcp-server.md`](../../docs/06-mcp-server.md) for the design.

---

## Registering with Claude Code

From the repo root:

```bash
claude mcp add shri 'pnpm --filter @shri/mcp start'
```

Or, equivalently, in `~/.claude.json` (or project-scoped
`.claude/settings.json`):

```json
{
  "mcpServers": {
    "shri": {
      "command": "pnpm",
      "args": ["--filter", "@shri/mcp", "start"],
      "env": {
        "OPENAI_API_KEY": "...",
        "OPENAI_BASE_URL": "https://api.openai.com/v1",
        "OPENAI_CHAT_MODEL": "gpt-4o",
        "OPENAI_IMAGE_MODEL": "gpt-image-1",
        "OPENAI_TTS_MODEL": "gpt-4o-mini-tts",
        "OPENAI_TTS_VOICE": "alloy",
        "ARK_API_KEY": "...",
        "R2_ACCOUNT_ID": "...",
        "R2_ACCESS_KEY_ID": "...",
        "R2_SECRET_ACCESS_KEY": "...",
        "R2_BUCKET": "shri-assets",
        "R2_PUBLIC_BASE_URL": "https://assets.example.com",
        "DATABASE_URL": "postgresql://localhost:5432/shri",
        "REDIS_URL": "redis://localhost:6379",
        "PROMPTS_DIR": "/abs/path/to/prompts-projects"
      }
    }
  }
}
```

The MCP process needs the same env as the worker because it calls the same
tool handlers.

---

## Smoke test

```bash
# Terminal A
pnpm --filter @shri/mcp start

# Terminal B
claude
> /mcp
# should list `shri` with all 20 tools
> use shri.list_project_assets with projectSlug "<your-slug>"
```

---

## Conventions Claude Code will see

The server sends a long `instructions` block on `initialize` (lives in
`src/instructions.ts`) covering:

- The 5-field `cameraPerspective` contract for `submit_seedance_job`
- Project-setup ordering (`crawl_product_site` -> `generate_project_prompts`
  -> optional character flow -> content)
- The `@ImageN` reference convention for Seedance prompts
- Single-scene-by-default reels; multi-scene only for genuine arcs
- Character + theme integration for `generate_image`
- Cost-awareness via `estimate_cost` before batches
- The mandatory `save_content_output` final step

Update the file; the smoke test in `src/index.test.ts` keeps the required
phrases honest.
