import type { z } from "zod/v4";

export function buildSchemas(z: typeof z) {
  const FileKeySchema = z
    .string()
    .describe("Figma file key from a Figma URL");
  const NodeIdSchema = z
    .string()
    .describe("Figma node ID, either 1:2 API format or 1-2 URL format");

  const MaxResponseChars = z
    .number()
    .min(1)
    .optional()
    .describe(
      "Maximum characters returned to the model before truncation",
    );

  const NodeProcessingOptions = {
    depth: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe("Depth limit for child hierarchy (default 2, max 4)"),
    includeHidden: z
      .boolean()
      .optional()
      .describe(
        "Include hidden layers (default false — hidden nodes, vectors, and component internals are omitted)",
      ),
    includeVectors: z
      .boolean()
      .optional()
      .describe(
        "Include vector/icon layers in results (default false)",
      ),
    includeComponentInternals: z
      .boolean()
      .optional()
      .describe(
        "Include component instance internals (default false)",
      ),
  };

  const RenderFormat = z
    .enum(["png", "jpg", "svg", "pdf"])
    .optional()
    .describe("Rendered asset format (default png)");
  const Scale = z
    .number()
    .min(0.01)
    .max(4)
    .optional()
    .describe("Render scale multiplier (default 2)");

  const ProcessedNodeBase = {
    fileKey: FileKeySchema,
    nodeId: NodeIdSchema,
    ...NodeProcessingOptions,
    maxResponseChars: MaxResponseChars,
  };

  const ProcessedNodeWithRender = {
    ...ProcessedNodeBase,
    renderImage: z
      .boolean()
      .optional()
      .describe("Render and download node image (default false)"),
    outputDir: z
      .string()
      .optional()
      .describe(
        "Directory for rendered assets (default: OS temp directory)",
      ),
    format: RenderFormat,
    scale: Scale,
  };

  const Framework = z
    .enum(["react", "html", "vue", "angular", "react-native"])
    .optional()
    .describe("Target framework for code snippets and hints");
  const Styling = z
    .enum([
      "css",
      "css-modules",
      "styled-components",
      "tailwind",
      "inline",
    ])
    .optional()
    .describe("Target styling approach for code hints");

  return {
    FileKeySchema,
    NodeIdSchema,
    MaxResponseChars,
    NodeProcessingOptions,
    ProcessedNodeBase,
    ProcessedNodeWithRender,
    RenderFormat,
    Scale,
    Framework,
    Styling,
  };
}

export function buildFigmaParams(z: typeof z) {
  const s = buildSchemas(z);

  return {
    FigmaParseUrlParams: z.object({
      url: z.string().describe("Figma design/file URL"),
    }),

    FigmaGetFileParams: z.object({
      fileKey: s.FileKeySchema,
      depth: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Optional Figma file depth query parameter"),
      maxResponseChars: s.MaxResponseChars,
    }),

    FigmaGetDesignContextParams: z.object({
      fileKey: s.FileKeySchema,
      nodeId: s.NodeIdSchema.optional().describe(
        "Optional node ID for targeted design context",
      ),
      maxResponseChars: s.MaxResponseChars,
    }),

    FigmaGetNodesParams: z.object({
      fileKey: s.FileKeySchema,
      nodeIds: z
        .array(s.NodeIdSchema)
        .min(1)
        .describe("One or more Figma node IDs"),
      maxResponseChars: s.MaxResponseChars,
    }),

    FigmaProcessedNodeParams: z.object(s.ProcessedNodeBase),

    FigmaProcessedNodeWithRenderParams: z.object(s.ProcessedNodeWithRender),

    FigmaImplementationContextParams: z.object({
      ...s.ProcessedNodeWithRender,
      framework: s.Framework,
      styling: s.Styling,
      resolveTokens: z
        .boolean()
        .optional()
        .describe(
          "Resolve Figma styles and variables into design tokens (default true)",
        ),
      includeCodeSnippets: z
        .boolean()
        .optional()
        .describe(
          "Include framework-specific starter code snippets (default false)",
        ),
    }),

    FigmaSingleFileParams: z.object({
      fileKey: s.FileKeySchema,
      maxResponseChars: s.MaxResponseChars,
    }),

    FigmaSearchComponentsParams: z.object({
      fileKey: s.FileKeySchema,
      query: z.string().describe("Search query for component name/description"),
      maxResponseChars: s.MaxResponseChars,
    }),

    FigmaFindNodesParams: z.object({
      fileKey: s.FileKeySchema,
      nodeId: s.NodeIdSchema.optional().describe(
        "Scope search to a subtree (recommended for large files)",
      ),
      query: z.string().describe("Search query for layer name or visible text"),
      ...s.NodeProcessingOptions,
      exact: z
        .boolean()
        .optional()
        .describe("Require exact match (default false)"),
      caseSensitive: z
        .boolean()
        .optional()
        .describe("Case-sensitive search (default false)"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max results (default 50)"),
      maxResponseChars: s.MaxResponseChars,
    }),

    FigmaRenderNodesParams: z.object({
      fileKey: s.FileKeySchema,
      nodeIds: z
        .array(s.NodeIdSchema)
        .min(1)
        .describe("One or more Figma node IDs to render"),
      format: s.RenderFormat,
      scale: s.Scale,
      outputDir: z
        .string()
        .optional()
        .describe(
          "Directory for downloaded assets (default: OS temp directory)",
        ),
      download: z
        .boolean()
        .optional()
        .describe("Download rendered images to disk (default true)"),
      maxResponseChars: s.MaxResponseChars,
    }),

    FigmaExtractAssetsParams: z.object({
      fileKey: s.FileKeySchema,
      nodeId: s.NodeIdSchema,
      assetTypes: z
        .array(z.enum(["svgIcons", "nodeRenders", "imageFills"]))
        .optional()
        .describe(
          "Asset types to extract (default: all three)",
        ),
      ...s.NodeProcessingOptions,
      maxAssets: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max assets (default 80)"),
      outputDir: z
        .string()
        .optional()
        .describe(
          "Directory for downloaded assets (default: OS temp directory)",
        ),
      maxResponseChars: s.MaxResponseChars,
    }),

    FigmaFindCodeConnectMappingParams: z.object({
      fileKey: s.FileKeySchema,
      nodeId: s.NodeIdSchema.optional(),
      componentKey: z
        .string()
        .optional()
        .describe("Specific Figma component key"),
      rootDir: z
        .string()
        .optional()
        .describe(
          "Root directory to scan (default: current working directory)",
        ),
      maxMatches: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max matches (default 40)"),
      maxResponseChars: s.MaxResponseChars,
    }),

    FigmaComponentImplementationHintsParams: z.object({
      fileKey: s.FileKeySchema,
      nodeId: s.NodeIdSchema,
      framework: s.Framework,
      styling: s.Styling,
      ...s.NodeProcessingOptions,
      includeCodeConnect: z
        .boolean()
        .optional()
        .describe(
          "Include local Code Connect scan results (default true)",
        ),
      includeSnippet: z
        .boolean()
        .optional()
        .describe("Include starter code snippet (default false)"),
      rootDir: z
        .string()
        .optional()
        .describe(
          "Root directory for Code Connect scan (default: current working directory)",
        ),
      renderImage: z
        .boolean()
        .optional()
        .describe("Render and download node image (default false)"),
      outputDir: z
        .string()
        .optional()
        .describe(
          "Directory for rendered assets (default: OS temp directory)",
        ),
      format: s.RenderFormat,
      scale: s.Scale,
      maxResponseChars: s.MaxResponseChars,
    }),
  };
}
