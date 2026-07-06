import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { buildFigmaParams } from "./lib/schemas.js";
import { FigmaClient, parseFigmaUrl } from "./lib/client.js";
import { sanitizeDetails } from "./lib/detail-sanitizer.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_PROCESSED_MAX_CHARS = 20_000;
const DEFAULT_RAW_MAX_CHARS = 40_000;

function buildDetails(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { items: value };
  if (typeof value === "object" && value !== null)
    return sanitizeDetails(value as Record<string, unknown>);
  return { value: String(value) };
}

function jsonToolResult(
  value: unknown,
  opts?: { maxChars?: number },
) {
  const text = JSON.stringify(value, null, 2);
  const max = opts?.maxChars ?? DEFAULT_PROCESSED_MAX_CHARS;
  const details = buildDetails(value);

  if (text.length <= max) {
    return {
      content: [{ type: "text" as const, text }],
      details,
    };
  }

  const truncated = text.slice(0, max);
  return {
    content: [
      {
        type: "text" as const,
        text: `${truncated}\n\n[truncated ${text.length - max} characters; inspect a narrower node or reduce scope]`,
      },
    ],
    details: {
      truncated: true,
      totalCharacters: text.length,
      ...details,
    },
  };
}

function textToolResult(
  text: string,
  meta?: Record<string, unknown>,
) {
  return {
    content: [{ type: "text" as const, text }],
    details: meta ?? {},
  };
}

function readTokenFromEnv(): string | null {
  return process.env.FIGMA_TOKEN || null;
}

async function readTokenFromAuthFile(): Promise<string | null> {
  try {
    const authFile = Bun.file(
      join(process.env.HOME || "~", ".omp", "agent", "auth.json"),
    );
    if (!(await authFile.exists())) return null;
    const data = await authFile.json();
    return (data as Record<string, unknown>)?.figma?.token as
      | string
      | null;
  } catch {
    return null;
  }
}

async function readToken(): Promise<string | null> {
  return (
    readTokenFromEnv() || (await readTokenFromAuthFile())
  );
}

async function storeToken(token: string): Promise<void> {
  const dir = join(
    process.env.HOME || "~",
    ".omp",
    "agent",
  );
  await Bun.write(
    join(dir, "auth.json"),
    JSON.stringify(
      {
        figma: { token },
      },
      null,
      2,
    ),
  );
}

export default function figmaExtension(pi: ExtensionAPI): void {
  const z = pi.zod;
  const params = buildFigmaParams(z);
  const client = new FigmaClient();

  // Initialize token from env/auth-file
  readToken().then((token) => {
    if (token) client.setToken(token);
  });

  // Auth configurator tool
  pi.registerTool({
    name: "figma_configure_auth",
    label: "Figma Configure Auth",
    description:
      "Securely prompt for and store a Figma personal access token. Run this when Figma auth is missing, invalid, expired, or the user asks to update the token. The token is stored locally and never returned to the model.",
    parameters: z.object({}),
    async execute(_toolCallId, _params) {
      // In omp, we use the auth file pattern. The token can be set via
      // FIGMA_TOKEN env var or auth.json. This tool guides the user.
      const existing = await readToken();
      if (existing) {
        client.setToken(existing);
        return textToolResult(
          "Figma token is already configured. To update it, set FIGMA_TOKEN environment variable or update ~/.omp/agent/auth.json.",
        );
      }
      return textToolResult(
        "No Figma token found. Set the FIGMA_TOKEN environment variable or create ~/.omp/agent/auth.json with { \"figma\": { \"token\": \"your-token-here\" } }.\n\nGenerate a token at: https://www.figma.com/settings/tokens\nRequired scope: File content (read-only).",
      );
    },
  });

  // Parse URL
  pi.registerTool({
    name: "figma_parse_url",
    label: "Figma Parse URL",
    description:
      "Parse a Figma URL into fileKey and nodeId values for the other figma_* tools.",
    parameters: params.FigmaParseUrlParams,
    async execute(_toolCallId, p) {
      return jsonToolResult(parseFigmaUrl(p.url));
    },
  });

  // Get design context
  pi.registerTool({
    name: "figma_get_design_context",
    label: "Figma Design Context",
    description:
      "Fetch compact LLM-ready Figma context. With nodeId returns target node summary, ancestors/page, and sibling names; without nodeId returns canvases and top-level frames only.",
    parameters: params.FigmaGetDesignContextParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      const result = await client.getDesignContext(
        p.fileKey,
        p.nodeId,
      );
      return jsonToolResult(result, {
        maxChars:
          p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
      });
    },
  });

  // Find nodes by name
  pi.registerTool({
    name: "figma_find_nodes_by_name",
    label: "Figma Find Nodes By Name",
    description:
      "Search Figma layer/node names within a file or scoped subtree. Returns compact path-aware matches with result caps.",
    parameters: params.FigmaFindNodesParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      const result = await client.findNodesByName(
        p.fileKey,
        p,
      );
      return jsonToolResult(result, {
        maxChars:
          p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
      });
    },
  });

  // Find nodes by text
  pi.registerTool({
    name: "figma_find_nodes_by_text",
    label: "Figma Find Nodes By Text",
    description:
      "Search visible Figma text nodes within a file or scoped subtree and return compact path-aware matches with nearest parent context.",
    parameters: params.FigmaFindNodesParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      const result = await client.findNodesByText(
        p.fileKey,
        p,
      );
      return jsonToolResult(result, {
        maxChars:
          p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
      });
    },
  });

  // Get node summary
  pi.registerTool({
    name: "figma_get_node_summary",
    label: "Figma Node Summary",
    description:
      "Fetch a compact structured summary of a Figma node: dimensions, layout, spacing, styles, visible text, component properties, and shallow child hierarchy. Default depth is 2.",
    parameters: params.FigmaProcessedNodeParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.getNodeSummary(
          p.fileKey,
          p.nodeId,
          {
            depth: p.depth,
            includeHidden: p.includeHidden,
            includeVectors: p.includeVectors,
            includeComponentInternals:
              p.includeComponentInternals,
          },
        ),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Extract text
  pi.registerTool({
    name: "figma_extract_text",
    label: "Figma Extract Text",
    description:
      "Extract visible text nodes from a Figma node without raw JSON. Hidden text is excluded by default.",
    parameters: params.FigmaProcessedNodeParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.extractText(p.fileKey, p.nodeId, {
          depth: p.depth,
          includeHidden: p.includeHidden,
          includeVectors: p.includeVectors,
          includeComponentInternals:
            p.includeComponentInternals,
        }),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Explain node
  pi.registerTool({
    name: "figma_explain_node",
    label: "Figma Explain Node",
    description:
      "Explain a Figma node in human-readable Markdown using compact summary, visible text, shallow hierarchy, and optional rendered image asset.",
    parameters: params.FigmaProcessedNodeWithRenderParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      let assets:
        | Array<{ nodeId: string; url?: string | null; path?: string }>
        | undefined;
      if (p.renderImage) {
        const rendered = await client.renderNodes(
          p.fileKey,
          [p.nodeId],
          {
            cwd: "/tmp",
            format: p.format,
            scale: p.scale,
            download: true,
            outputDir: p.outputDir,
          },
        );
        assets = Object.entries(rendered.images).map(
          ([nodeId, url]) => ({
            nodeId,
            url,
            path: rendered.savedFiles.find(
              (f) => f.nodeId === nodeId,
            )?.path,
          }),
        );
      }
      const result = await client.explainNode(
        p.fileKey,
        p.nodeId,
        {
          depth: p.depth,
          includeHidden: p.includeHidden,
          includeVectors: p.includeVectors,
          includeComponentInternals:
            p.includeComponentInternals,
          assets,
        },
      );
      const max =
        p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS;
      const truncated = result.length > max;
      const output = truncated
        ? `${result.slice(0, max)}\n\n[truncated ${result.length - max} characters; call figma_get_node_summary on a narrower child node]`
        : result;
      return textToolResult(output, {
        truncated,
        characters: result.length,
      });
    },
  });

  // Implementation context
  pi.registerTool({
    name: "figma_get_implementation_context",
    label: "Figma Implementation Context",
    description:
      "Return concise design-to-code context for a Figma node: purpose, sections, fields/buttons, measurements, typography, colors, spacing, CSS layout/responsive hints, accessibility hints, design tokens, assets, and optional framework starter snippets.",
    parameters: params.FigmaImplementationContextParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      let assets:
        | Array<{ nodeId: string; url?: string | null; path?: string }>
        | undefined;
      if (p.renderImage) {
        const rendered = await client.renderNodes(
          p.fileKey,
          [p.nodeId],
          {
            cwd: "/tmp",
            format: p.format,
            scale: p.scale,
            download: true,
            outputDir: p.outputDir,
          },
        );
        assets = Object.entries(rendered.images).map(
          ([nodeId, url]) => ({
            nodeId,
            url,
            path: rendered.savedFiles.find(
              (f) => f.nodeId === nodeId,
            )?.path,
          }),
        );
      }
      return jsonToolResult(
        await client.getImplementationContext(
          p.fileKey,
          p.nodeId,
          {
            depth: p.depth,
            includeHidden: p.includeHidden,
            includeVectors: p.includeVectors,
            includeComponentInternals:
              p.includeComponentInternals,
            assets,
            framework: p.framework,
            styling: p.styling,
            resolveTokens: p.resolveTokens,
            includeCodeSnippets: p.includeCodeSnippets,
          },
        ),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Raw file
  pi.registerTool({
    name: "figma_get_file",
    label: "Figma File",
    description:
      "Fetch a raw Figma file JSON document. Use only when raw Figma JSON is explicitly needed or when debugging.",
    parameters: params.FigmaGetFileParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.getFile(p.fileKey, p.depth),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_RAW_MAX_CHARS,
        },
      );
    },
  });

  // Raw nodes
  pi.registerTool({
    name: "figma_get_nodes",
    label: "Figma Nodes",
    description:
      "Fetch raw Figma JSON for one or more nodes/frames/components by node ID. Use only when raw JSON is explicitly needed.",
    parameters: params.FigmaGetNodesParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.getNodes(p.fileKey, p.nodeIds),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_RAW_MAX_CHARS,
        },
      );
    },
  });

  // Node metadata
  pi.registerTool({
    name: "figma_get_node_metadata",
    label: "Figma Node Metadata",
    description:
      "Fetch compact spatial/layout metadata for one or more Figma nodes.",
    parameters: params.FigmaGetNodesParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.getNodeMetadata(
          p.fileKey,
          p.nodeIds,
        ),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Styles
  pi.registerTool({
    name: "figma_get_styles",
    label: "Figma Styles",
    description:
      "Fetch named styles from a Figma file, including colors, text, effects, and grids.",
    parameters: params.FigmaSingleFileParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.getStyles(p.fileKey),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Variables
  pi.registerTool({
    name: "figma_get_variables",
    label: "Figma Variables",
    description:
      "Fetch local Figma variables and collections for design tokens.",
    parameters: params.FigmaSingleFileParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.getVariables(p.fileKey),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Components
  pi.registerTool({
    name: "figma_get_components",
    label: "Figma Components",
    description: "Fetch Figma component metadata for a file.",
    parameters: params.FigmaSingleFileParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.getComponents(p.fileKey),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Component sets
  pi.registerTool({
    name: "figma_get_component_sets",
    label: "Figma Component Sets",
    description:
      "Fetch Figma component set metadata for a file.",
    parameters: params.FigmaSingleFileParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.getComponentSets(p.fileKey),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Search components
  pi.registerTool({
    name: "figma_search_components",
    label: "Figma Search Components",
    description:
      "Search Figma components in a file by name or description.",
    parameters: params.FigmaSearchComponentsParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.searchComponents(
          p.fileKey,
          p.query,
        ),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Render nodes
  pi.registerTool({
    name: "figma_render_nodes",
    label: "Figma Render Nodes",
    description:
      "Render one or more Figma nodes to image URLs and optionally download them as local assets.",
    parameters: params.FigmaRenderNodesParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.renderNodes(
          p.fileKey,
          p.nodeIds,
          {
            cwd: "/tmp",
            format: p.format,
            scale: p.scale,
            outputDir: p.outputDir,
            download: p.download,
          },
        ),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Extract assets
  pi.registerTool({
    name: "figma_extract_assets",
    label: "Figma Extract Assets",
    description:
      "Extract a compact asset manifest for a Figma subtree, including SVG/icon exports, node renders, image fills, node paths, hashes, sizes, and local file paths when downloaded.",
    parameters: params.FigmaExtractAssetsParams,
    async execute(_toolCallId, p, _signal, _onUpdate) {
      return jsonToolResult(
        await client.extractAssets(
          p.fileKey,
          p.nodeId,
          {
            depth: p.depth,
            assetTypes: p.assetTypes,
            includeHidden: p.includeHidden,
            maxAssets: p.maxAssets,
            cwd: "/tmp",
            outputDir: p.outputDir,
          },
        ),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Find Code Connect mapping
  pi.registerTool({
    name: "figma_find_code_connect_mapping",
    label: "Figma Find Code Connect Mapping",
    description:
      "Scan the local repo for Code Connect files, figma.connect calls, Figma URLs, node IDs, and component keys matching a target. No live Figma request is required.",
    parameters: params.FigmaFindCodeConnectMappingParams,
    async execute(_toolCallId, p, _signal, _onUpdate, ctx) {
      return jsonToolResult(
        await client.findCodeConnectMapping({
          fileKey: p.fileKey,
          nodeId: p.nodeId,
          componentKey: p.componentKey,
          rootDir: p.rootDir,
          maxMatches: p.maxMatches,
          cwd: ctx.cwd,
        }),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  // Component implementation hints
  pi.registerTool({
    name: "figma_get_component_implementation_hints",
    label: "Figma Component Implementation Hints",
    description:
      "Combine Figma summary, implementation context, variants/properties, accessibility, token dependencies, assets, optional local Code Connect matches, and starter snippets into compact component implementation guidance.",
    parameters:
      params.FigmaComponentImplementationHintsParams,
    async execute(_toolCallId, p, _signal, _onUpdate, ctx) {
      return jsonToolResult(
        await client.getComponentImplementationHints(
          p.fileKey,
          p.nodeId,
          {
            depth: p.depth,
            includeHidden: p.includeHidden,
            includeVectors: p.includeVectors,
            includeComponentInternals:
              p.includeComponentInternals,
            framework: p.framework,
            styling: p.styling,
            includeCodeConnect: p.includeCodeConnect,
            includeSnippet: p.includeSnippet,
            rootDir: p.rootDir,
            cwd: ctx.cwd,
          },
        ),
        {
          maxChars:
            p.maxResponseChars ?? DEFAULT_PROCESSED_MAX_CHARS,
        },
      );
    },
  });

  pi.logger?.info?.("Figma extension loaded — 21 tools registered");
}
