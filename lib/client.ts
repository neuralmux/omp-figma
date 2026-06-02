import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createTtlCache } from "./cache.js";
import { asRecord, clampInteger, getNestedArray, stringValue } from "./helpers.js";
import {
  collectAssetCandidates,
  manifestEntryFromFile,
  manifestEntryFromUrl,
  safeFilename,
  type FigmaAssetManifestEntry,
  type FigmaAssetType,
  type FigmaExtractAssetsResult,
} from "./assets.js";
import {
  findCodeConnectMapping,
  type CodeConnectScanResult,
} from "./code-connect.js";
import {
  buildComponentImplementationHints,
  type FigmaComponentImplementationHints,
} from "./component-hints.js";
import {
  explainNode,
  extractVisibleText,
  getImplementationContext,
  summarizeNode,
  type FigmaImplementationContext,
  type FigmaImplementationContextOptions,
  type FigmaNodeSummary,
  type FigmaRenderedAsset,
  type FigmaSummarizerOptions,
  type FigmaTextExtractionResult,
} from "./summarizer.js";
import {
  findNodesByName,
  findNodesByText,
  type FigmaFindNodesOptions,
  type FigmaNodeSearchResult,
} from "./search.js";
import { buildFigmaTokenMap } from "./tokens.js";

const figmaCache = createTtlCache<unknown>({
  defaultTtlMs: 5 * 60 * 1000,
  maxEntries: 100,
});

let rateLimitTimer: Promise<void> = Promise.resolve();

function rateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const prev = rateLimitTimer;
  let resolveNext: () => void;
  rateLimitTimer = new Promise<void>((r) => { resolveNext = r; });
  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      setTimeout(resolveNext!, 1000);
    }
  });
}

export interface FigmaClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export interface RenderNodesOptions {
  format?: "png" | "jpg" | "svg" | "pdf";
  scale?: number;
  outputDir?: string;
  download?: boolean;
  cwd: string;
}

export interface ExtractAssetsOptions {
  depth?: number;
  assetTypes?: FigmaAssetType[];
  outputDir?: string;
  includeHidden?: boolean;
  maxAssets?: number;
  cwd: string;
}

export interface ComponentHintsOptions
  extends FigmaImplementationContextOptions {
  includeCodeConnect?: boolean;
  includeSnippet?: boolean;
  rootDir?: string;
  cwd: string;
}

export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId?: string;
}

export interface RenderNodesResult {
  images: Record<string, string | null>;
  savedFiles: Array<{ nodeId: string; path: string }>;
}

export class FigmaClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private token: string | null = null;

  constructor(options: FigmaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://api.figma.com";
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private getToken(): string {
    if (!this.token) throw new Error("Figma token not configured. Call figma_configure_auth first.");
    return this.token;
  }

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { "X-Figma-Token": this.getToken() },
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Figma API error ${res.status}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async get<T>(path: string): Promise<T> {
    return rateLimited(() => this.request<T>(path));
  }

  async download(url: string): Promise<Uint8Array> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  getFile(fileKey: string, depth?: number): Promise<unknown> {
    const query = depth ? `?depth=${depth}` : "";
    return figmaCache.getOrSet(
      `file:${fileKey}:${depth ?? "all"}`,
      () => this.get(`/v1/files/${fileKey}${query}`),
    );
  }

  getNodes(
    fileKey: string,
    nodeIds: readonly string[],
    depth?: number,
  ): Promise<unknown> {
    const ids = normalizeNodeIds(nodeIds).join(",");
    const depthQuery = depth ? `&depth=${clampInteger(depth, 1, 4)}` : "";
    return figmaCache.getOrSet(
      `nodes:${fileKey}:${ids}:${depth ?? "all"}`,
      () =>
        this.get(
          `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}${depthQuery}`,
        ),
    );
  }

  getStyles(fileKey: string): Promise<unknown> {
    return figmaCache.getOrSet(`styles:${fileKey}`, () =>
      this.get(`/v1/files/${fileKey}/styles`),
    );
  }

  getComponents(fileKey: string): Promise<unknown> {
    return figmaCache.getOrSet(`components:${fileKey}`, () =>
      this.get(`/v1/files/${fileKey}/components`),
    );
  }

  getComponentSets(fileKey: string): Promise<unknown> {
    return figmaCache.getOrSet(`componentSets:${fileKey}`, () =>
      this.get(`/v1/files/${fileKey}/component_sets`),
    );
  }

  getVariables(fileKey: string): Promise<unknown> {
    return figmaCache.getOrSet(`variables:${fileKey}`, () =>
      this.get(`/v1/files/${fileKey}/variables/local`),
    );
  }

  async searchComponents(
    fileKey: string,
    query: string,
  ): Promise<unknown> {
    const response = await this.getComponents(fileKey);
    const components = getNestedArray(response, ["meta", "components"]);
    const needle = query.toLowerCase();
    return components.filter((component) => {
      const record = component as Record<string, unknown>;
      return (
        String(record.name ?? "")
          .toLowerCase()
          .includes(needle) ||
        String(record.description ?? "")
          .toLowerCase()
          .includes(needle)
      );
    });
  }

  async getDesignContext(
    fileKey: string,
    nodeId?: string,
  ): Promise<unknown> {
    if (nodeId) return this.getTargetDesignContext(fileKey, nodeId);

    const file = await this.getFile(fileKey, 2);
    const fileRecord = asRecord(file);
    return {
      file: {
        name: fileRecord.name,
        lastModified: fileRecord.lastModified,
        version: fileRecord.version,
      },
      document: {
        name: asRecord(fileRecord.document).name,
        children: collectTopLevelStructure(fileRecord.document),
      },
      metadata: {
        truncated: true,
        note: "Only canvases and top-level frames are returned by default. Pass nodeId and use processed node tools for details.",
        nextSteps: [
          "Call figma_get_node_summary or figma_explain_node for a specific node.",
          "Use figma_get_file only for raw debugging.",
        ],
      },
    };
  }

  async getNodeSummary(
    fileKey: string,
    nodeId: string,
    options: FigmaSummarizerOptions = {},
  ): Promise<FigmaNodeSummary> {
    const doc = await this.getSingleNodeDocument(
      fileKey,
      nodeId,
      options.depth ?? 2,
    );
    return summarizeNode(doc, options);
  }

  async extractText(
    fileKey: string,
    nodeId: string,
    options: FigmaSummarizerOptions = {},
  ): Promise<FigmaTextExtractionResult> {
    const doc = await this.getSingleNodeDocument(
      fileKey,
      nodeId,
      options.depth ?? 2,
    );
    return extractVisibleText(doc, options);
  }

  async explainNode(
    fileKey: string,
    nodeId: string,
    options: FigmaSummarizerOptions & { assets?: FigmaRenderedAsset[] } = {},
  ): Promise<string> {
    const doc = await this.getSingleNodeDocument(
      fileKey,
      nodeId,
      options.depth ?? 2,
    );
    return explainNode(doc, options);
  }

  async getImplementationContext(
    fileKey: string,
    nodeId: string,
    options: FigmaImplementationContextOptions = {},
  ): Promise<FigmaImplementationContext> {
    const doc = await this.getSingleNodeDocument(
      fileKey,
      nodeId,
      options.depth ?? 2,
    );
    if (options.resolveTokens === false)
      return getImplementationContext(doc, options);
    try {
      const [styles, variables] = await Promise.all([
        this.getStyles(fileKey),
        this.getVariables(fileKey),
      ]);
      return getImplementationContext(doc, {
        ...options,
        tokenMap: buildFigmaTokenMap(styles, variables),
      });
    } catch {
      return getImplementationContext(doc, options);
    }
  }

  async findNodesByName(
    fileKey: string,
    params: FigmaFindNodesOptions & { nodeId?: string },
  ): Promise<FigmaNodeSearchResult> {
    const doc = await this.getSearchRoot(fileKey, params);
    const result = findNodesByName(doc, params);
    if (!params.nodeId) {
      result.metadata.nextSteps.unshift(
        "Full-file search is depth-limited; pass nodeId from figma_get_design_context to search a specific frame more precisely.",
      );
    }
    return result;
  }

  async findNodesByText(
    fileKey: string,
    params: FigmaFindNodesOptions & { nodeId?: string },
  ): Promise<FigmaNodeSearchResult> {
    const doc = await this.getSearchRoot(fileKey, params);
    const result = findNodesByText(doc, params);
    if (!params.nodeId) {
      result.metadata.nextSteps.unshift(
        "Full-file search is depth-limited; pass nodeId from figma_get_design_context to search a specific frame more precisely.",
      );
    }
    return result;
  }

  async getNodeMetadata(
    fileKey: string,
    nodeIds: readonly string[],
  ): Promise<unknown> {
    const response = await this.getNodes(fileKey, nodeIds, 2);
    const nodes = asRecord(response).nodes;
    return Object.entries(asRecord(nodes)).map(([id, value]) => {
      const document = asRecord(asRecord(value).document);
      return {
        id,
        name: document.name,
        type: document.type,
        boundingBox: document.absoluteBoundingBox,
        constraints: document.constraints,
        layout: {
          layoutMode: document.layoutMode,
          itemSpacing: document.itemSpacing,
          paddingLeft: document.paddingLeft,
          paddingRight: document.paddingRight,
          paddingTop: document.paddingTop,
          paddingBottom: document.paddingBottom,
          primaryAxisAlignItems: document.primaryAxisAlignItems,
          counterAxisAlignItems: document.counterAxisAlignItems,
        },
        cornerRadius: document.cornerRadius,
        opacity: document.opacity,
        effects: document.effects ?? [],
        fills: document.fills ?? [],
        strokes: document.strokes ?? [],
        strokeWeight: document.strokeWeight,
        children: getNestedArray(document, ["children"]).map(
          (child) => {
            const c = asRecord(child);
            return {
              id: c.id,
              name: c.name,
              type: c.type,
              boundingBox: c.absoluteBoundingBox,
              visible: c.visible ?? true,
            };
          },
        ),
      };
    });
  }

  async renderNodes(
    fileKey: string,
    nodeIds: readonly string[],
    options: RenderNodesOptions,
  ): Promise<RenderNodesResult> {
    const ids = normalizeNodeIds(nodeIds).join(",");
    const format = options.format ?? "png";
    const scale = options.scale ?? 2;
    const response = await this.get<{
      images?: Record<string, string | null>;
      err?: string;
    }>(
      `/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=${format}&scale=${scale}`,
    );
    if (response.err) throw new Error(response.err);

    const images = response.images ?? {};
    const savedFiles: Array<{ nodeId: string; path: string }> = [];
    if (options.download ?? true) {
      const outputDir = await resolveOutputDir(
        options.cwd,
        options.outputDir,
      );
      await mkdir(outputDir, { recursive: true });
      for (const [nodeId, url] of Object.entries(images)) {
        if (!url) continue;
        const ext = format === "jpg" ? "jpg" : format;
        const safeId = nodeId.replace(/[^a-z0-9_-]/gi, "_");
        const outputPath = resolve(
          outputDir,
          `${fileKey}_${safeId}.${ext}`,
        );
        const bytes = await this.download(url);
        await writeFile(outputPath, Buffer.from(bytes));
        savedFiles.push({ nodeId, path: outputPath });
      }
    }
    return { images, savedFiles };
  }

  getImageFills(fileKey: string): Promise<Record<string, string>> {
    return figmaCache.getOrSet(`imageFills:${fileKey}`, async () => {
      const response = await this.get<{
        meta?: { images?: Record<string, string> };
      }>(`/v1/files/${fileKey}/images`);
      return response.meta?.images ?? {};
    });
  }

  async extractAssets(
    fileKey: string,
    nodeId: string,
    options: ExtractAssetsOptions,
  ): Promise<FigmaExtractAssetsResult> {
    const document = await this.getSingleNodeDocument(
      fileKey,
      nodeId,
      options.depth ?? 3,
    );
    const assetTypes = options.assetTypes?.length
      ? options.assetTypes
      : (["svgIcons", "nodeRenders", "imageFills"] as FigmaAssetType[]);
    const collected = collectAssetCandidates(document, {
      assetTypes,
      includeHidden: options.includeHidden,
      maxAssets: options.maxAssets,
    });
    const outputDir = await resolveOutputDir(
      options.cwd,
      options.outputDir,
    );
    await mkdir(outputDir, { recursive: true });
    const manifest: FigmaAssetManifestEntry[] = [];

    const svgCandidates = collected.assets.filter(
      (a) => a.kind === "svgIcon" && a.nodeId,
    );
    if (svgCandidates.length) {
      const rendered = await this.renderNodes(
        fileKey,
        svgCandidates.map((a) => a.nodeId as string),
        { cwd: options.cwd, outputDir, format: "svg", download: true },
      );
      for (const c of svgCandidates) {
        const file = rendered.savedFiles.find(
          (s) => s.nodeId === c.nodeId,
        );
        manifest.push(
          file
            ? await manifestEntryFromFile(
                c,
                file.path,
                rendered.images[c.nodeId as string],
                "svg",
              )
            : manifestEntryFromUrl(
                c,
                rendered.images[c.nodeId as string],
                "svg",
              ),
        );
      }
    }

    const renderCandidates = collected.assets.filter(
      (a) => a.kind === "nodeRender" && a.nodeId,
    );
    if (renderCandidates.length) {
      const rendered = await this.renderNodes(
        fileKey,
        renderCandidates.map((a) => a.nodeId as string),
        { cwd: options.cwd, outputDir, format: "png", download: true },
      );
      for (const c of renderCandidates) {
        const file = rendered.savedFiles.find(
          (s) => s.nodeId === c.nodeId,
        );
        manifest.push(
          file
            ? await manifestEntryFromFile(
                c,
                file.path,
                rendered.images[c.nodeId as string],
                "png",
              )
            : manifestEntryFromUrl(
                c,
                rendered.images[c.nodeId as string],
                "png",
              ),
        );
      }
    }

    const imageFillCandidates = collected.assets.filter(
      (a) => a.kind === "imageFill" && a.imageRef,
    );
    if (imageFillCandidates.length) {
      const images = await this.getImageFills(fileKey);
      for (const c of imageFillCandidates) {
        const url = images[c.imageRef as string];
        if (!url) {
          manifest.push(manifestEntryFromUrl(c, null, "unknown"));
          continue;
        }
        const bytes = await this.download(url);
        const ext = url.includes(".webp")
          ? "webp"
          : url.includes(".jpg") || url.includes(".jpeg")
            ? "jpg"
            : "png";
        const outputPath = resolve(
          outputDir,
          `${safeFilename(c.suggestedName.replace(/\.[^.]+$/, ""))}-${safeFilename(c.imageRef as string).slice(0, 12)}.${ext}`,
        );
        await writeFile(outputPath, Buffer.from(bytes));
        manifest.push(
          await manifestEntryFromFile(c, outputPath, url, ext),
        );
      }
    }

    const unresolvedFills = manifest.filter(
      (e) => e.kind === "imageFill" && !e.url,
    ).length;
    return {
      nodeId: normalizeNodeId(nodeId),
      assetTypes,
      assets: manifest,
      metadata: {
        truncated: collected.metadata.truncated,
        truncatedReasons: [
          ...collected.metadata.truncatedReasons,
          ...(unresolvedFills
            ? [
                `${unresolvedFills} image fill(s) could not be resolved to downloadable URLs.`,
              ]
            : []),
        ],
        nextSteps: [
          ...collected.metadata.nextSteps,
          "Use manifest nodePath values to map downloaded files back to source Figma layers.",
        ],
      },
    };
  }

  findCodeConnectMapping(options: {
    fileKey: string;
    nodeId?: string;
    componentKey?: string;
    rootDir?: string;
    maxMatches?: number;
    cwd: string;
  }): Promise<CodeConnectScanResult> {
    return findCodeConnectMapping(options);
  }

  async getComponentImplementationHints(
    fileKey: string,
    nodeId: string,
    options: ComponentHintsOptions,
  ): Promise<FigmaComponentImplementationHints> {
    const summary = await this.getNodeSummary(fileKey, nodeId, options);
    const implementation = await this.getImplementationContext(
      fileKey,
      nodeId,
      {
        ...options,
        includeCodeSnippets:
          options.includeSnippet ?? options.includeCodeSnippets,
      },
    );
    const codeConnect =
      options.includeCodeConnect === false
        ? undefined
        : await this.findCodeConnectMapping({
            fileKey,
            nodeId,
            rootDir: options.rootDir,
            cwd: options.cwd,
          });
    return buildComponentImplementationHints(
      summary,
      implementation,
      {
        framework: options.framework,
        styling: options.styling,
        includeSnippet:
          options.includeSnippet ?? options.includeCodeSnippets,
        includeCodeConnect: options.includeCodeConnect !== false,
      },
      codeConnect,
    );
  }

  private async getTargetDesignContext(
    fileKey: string,
    nodeId: string,
  ): Promise<unknown> {
    const [file, targetSummary] = await Promise.all([
      this.getFile(fileKey, 2),
      this.getNodeSummary(fileKey, nodeId, { depth: 2 }),
    ]);
    const fileRecord = asRecord(file);
    const normalized = normalizeNodeId(nodeId);
    const shallowStructure = collectTopLevelStructure(
      fileRecord.document,
    );
    const targetLocation = findShallowLocation(
      fileRecord.document,
      normalized,
    );

    return {
      file: {
        name: fileRecord.name,
        lastModified: fileRecord.lastModified,
        version: fileRecord.version,
      },
      targetNode: targetSummary,
      location: targetLocation ?? {
        targetNodeId: normalized,
        note: "Target node is not present in the shallow file tree, so ancestors/siblings are unavailable without raw debugging.",
      },
      document: {
        name: asRecord(fileRecord.document).name,
        children: shallowStructure,
      },
      metadata: {
        truncated: targetSummary.metadata?.truncated ?? true,
        note: "Design context is compact: target summary plus shallow file structure only.",
        nextSteps: targetSummary.metadata?.nextSteps?.length
          ? targetSummary.metadata.nextSteps
          : [
              "Call figma_explain_node for a human-readable explanation.",
              "Call figma_get_implementation_context for coding details.",
            ],
      },
    };
  }

  private async getSingleNodeDocument(
    fileKey: string,
    nodeId: string,
    depth: number,
  ): Promise<unknown> {
    const normalized = normalizeNodeId(nodeId);
    const response = await this.getNodes(fileKey, [normalized], depth);
    const document = asRecord(
      asRecord(asRecord(response).nodes)[normalized],
    ).document;
    if (!document)
      throw new Error(
        `Figma node ${normalized} was not found in file ${fileKey}.`,
      );
    return document;
  }

  private async getSearchRoot(
    fileKey: string,
    params: FigmaFindNodesOptions & { nodeId?: string },
  ): Promise<unknown> {
    const depth = params.depth
      ? clampInteger(params.depth, 1, 4)
      : 4;
    if (params.nodeId)
      return this.getSingleNodeDocument(
        fileKey,
        params.nodeId,
        depth,
      );
    const file = await this.getFile(fileKey, depth);
    return asRecord(file).document;
  }
}

export function parseFigmaUrl(url: string): ParsedFigmaUrl {
  const match = url.match(
    /figma\.com\/(file|design)\/([a-zA-Z0-9]+)(?:\/[^?]*)?(?:\?.*node-id=([^&]+))?/,
  );
  if (!match) return { fileKey: url };
  return {
    fileKey: match[2],
    nodeId: match[3] ? match[3].replace(/-/g, ":") : undefined,
  };
}

export function normalizeNodeId(nodeId: string): string {
  return nodeId.replace(/-/g, ":");
}

function normalizeNodeIds(nodeIds: readonly string[]): string[] {
  return nodeIds.map(normalizeNodeId);
}

async function resolveOutputDir(
  cwd: string,
  outputDir?: string,
): Promise<string> {
  if (outputDir) {
    return isAbsolute(outputDir) ? outputDir : resolve(cwd, outputDir);
  }
  return mkdtemp(join(tmpdir(), "figma-"));
}

function collectTopLevelStructure(value: unknown): Array<{
  id: unknown;
  name: unknown;
  type: unknown;
  children?: Array<{ id: unknown; name: unknown; type: unknown }>;
}> {
  const document = asRecord(value);
  return (getNestedArray(document, ["children"]) as unknown[]).map(
    (child) => {
      const c = asRecord(child);
      const pageChildren = Array.isArray(c.children)
        ? c.children.map((gc) => {
            const g = asRecord(gc);
            return {
              id: g.id,
              name: g.name,
              type: g.type,
            };
          })
        : undefined;
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        children: pageChildren,
      };
    },
  );
}

function findShallowLocation(
  value: unknown,
  nodeId: string,
): unknown {
  function search(
    node: unknown,
    path: string[],
  ): { ancestors: string[]; path: string } | null {
    const record = asRecord(node);
    const currentId = stringValue(record.id);
    if (currentId === nodeId) {
      return {
        ancestors: path.filter(Boolean),
        path: [...path, String(record.name ?? "")].join(" > "),
      };
    }
    for (const child of getNestedArray(record, ["children"])) {
      const found = search(child, [
        ...path,
        String(record.name ?? ""),
      ]);
      if (found) return found;
    }
    return null;
  }
  return search(value, []);
}
