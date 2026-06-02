# omp-figma

Figma design integration for Oh My Pi. Registers 21 native `figma_*` tools that the LLM can call to read Figma design files — summaries, implementation context, screenshots, components, styles, variables, design tokens, and more.

## Install

**Option A — project-local:** copy or symlink into your project's `.omp/extensions/` directory.

**Option B — user-level:** drop into `~/.omp/agent/extensions/` to load globally.

```bash
cp -r .omp/extensions/figma ~/.omp/agent/extensions/figma
```

**Option C — config:** point the `extensions` setting at the directory.

```yaml
# ~/.omp/agent/config.yml
extensions:
  - /path/to/omp-figma
```

**Option D — CLI flag:**

```bash
omp --extension /path/to/omp-figma
```

## Auth

Set the token via environment variable:

```bash
export FIGMA_TOKEN="figd_xxx"
```

Or create `~/.omp/agent/auth.json`:

```json
{
  "figma": {
    "token": "figd_xxx"
  }
}
```

Generate a token at https://www.figma.com/settings/tokens (File content scope, read-only).

## Tools

All tools are prefixed `figma_*`. The LLM discovers them automatically from the skill file (`skills/figma/SKILL.md`).

Key tools:

- `figma_parse_url` — extract fileKey/nodeId from a Figma URL
- `figma_get_design_context` — compact LLM-ready context for a node/page
- `figma_get_node_summary` — dimensions, layout, spacing, styles, text, children
- `figma_explain_node` — human-readable Markdown explanation
- `figma_get_implementation_context` — code-ready context (CSS layout, colors, typography, tokens)
- `figma_render_nodes` — screenshot rendering (PNG/JPG/SVG/PDF)
- `figma_extract_assets` — asset manifest (icons, renders, image fills)
- `figma_get_component_implementation_hints` — component-level implementation planning
- `figma_get_styles`, `figma_get_variables` — design tokens
- `figma_get_components`, `figma_get_component_sets` — component metadata
- `figma_find_nodes_by_name`, `figma_find_nodes_by_text` — search layers
- `figma_find_code_connect_mapping` — scan local repo for Code Connect references
- `figma_configure_auth` — guide for setting up the token

Full workflow guidance is in `skills/figma/SKILL.md`.

## Structure

```
index.ts          — extension entry point (registers 21 tools)
lib/
  client.ts       — FigmaClient: wraps the Figma REST API with rate-limiting and caching
  schemas.ts      — Zod parameter schemas for all tools
  summarizer.ts   — node summarization, text extraction, explanations, implementation context
  implementation.ts — CSS layout, responsive, accessibility, framework, and token hint builders
  code-connect.ts — local repo scanning for Code Connect / Figma URL references
  component-hints.ts — component implementation hints (variants, props, tokens, snippets)
  assets.ts       — asset candidate collection, SVG/icon detection, file manifests
  search.ts       — findNodesByName / findNodesByText with depth-limited walk
  tokens.ts       — builds FigmaTokenMap from styles + variables responses
  cache.ts        — TTL cache for API responses
  helpers.ts      — record/value utilities
skills/
  figma/
    SKILL.md      — LLM skill instructions for using the tools
```
