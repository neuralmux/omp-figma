import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { asRecord, clampInteger, stringValue } from "./helpers.js";

export type FigmaAssetType = "svgIcons" | "nodeRenders" | "imageFills";
export type FigmaAssetKind = "svgIcon" | "nodeRender" | "imageFill";

export interface FigmaAssetCandidate {
  kind: FigmaAssetKind;
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  nodePath: string;
  imageRef?: string;
  fillIndex?: number;
  suggestedName: string;
}

export interface FigmaAssetManifestEntry
  extends FigmaAssetCandidate {
  format: "png" | "jpg" | "svg" | "webp" | "unknown";
  path?: string;
  url?: string | null;
  sha256?: string;
  bytes?: number;
}

export interface FigmaAssetCollectionResult {
  assets: FigmaAssetCandidate[];
  metadata: {
    truncated: boolean;
    truncatedReasons: string[];
    nextSteps: string[];
  };
}

export interface FigmaExtractAssetsResult {
  nodeId: string;
  assetTypes: FigmaAssetType[];
  assets: FigmaAssetManifestEntry[];
  metadata: {
    truncated: boolean;
    truncatedReasons: string[];
    nextSteps: string[];
  };
}

const VECTOR_TYPES: Record<string, true> = {
  VECTOR: true,
  BOOLEAN_OPERATION: true,
  STAR: true,
  LINE: true,
  ELLIPSE: true,
  POLYGON: true,
  REGULAR_POLYGON: true,
};

const DEFAULT_MAX_ASSETS = 80;

export function collectAssetCandidates(
  node: unknown,
  options: {
    assetTypes?: FigmaAssetType[];
    includeHidden?: boolean;
    maxAssets?: number;
  } = {},
): FigmaAssetCollectionResult {
  const assetTypes = options.assetTypes?.length
    ? new Set(options.assetTypes)
    : new Set<FigmaAssetType>([
        "svgIcons",
        "nodeRenders",
        "imageFills",
      ]);
  const includeHidden = options.includeHidden ?? false;
  const maxAssets = clampInteger(
    options.maxAssets ?? DEFAULT_MAX_ASSETS,
    1,
    200,
  );
  const assets: FigmaAssetCandidate[] = [];
  const truncatedReasons: string[] = [];
  let skippedHidden = 0;
  let skippedDeep = 0;

  walk(node, includeHidden, (record, path, level) => {
    if (level > 8) {
      skippedDeep += 1;
      return;
    }
    if (assets.length >= maxAssets) {
      if (
        !truncatedReasons.some((r) =>
          r.includes("maxAssets"),
        )
      )
        truncatedReasons.push(
          `Reached maxAssets ${maxAssets}; additional candidates were omitted.`,
        );
      return;
    }
    const type = String(record.type ?? "").toUpperCase();
    const name = String(record.name ?? "unnamed");

    if (
      assetTypes.has("svgIcons") &&
      isIconCandidate(record)
    ) {
      assets.push({
        kind: "svgIcon",
        nodeId: stringValue(record.id),
        nodeName: name,
        nodeType: type,
        nodePath: path,
        suggestedName: safeFilename(name) + ".svg",
      });
    }

    if (assetTypes.has("nodeRenders") && !(type in VECTOR_TYPES)) {
      assets.push({
        kind: "nodeRender",
        nodeId: stringValue(record.id),
        nodeName: name,
        nodeType: type,
        nodePath: path,
        suggestedName: safeFilename(name) + ".png",
      });
    }

    if (assetTypes.has("imageFills")) {
      const fills = Array.isArray(record.fills)
        ? record.fills
        : [];
      fills.forEach(
        (fill: unknown, idx: number) => {
          const f = asRecord(fill);
          if (
            (f.type === "IMAGE" ||
              (typeof f.type === "string" &&
                f.type.includes("IMAGE"))) &&
            f.imageRef
          ) {
            assets.push({
              kind: "imageFill",
              nodeId: stringValue(record.id),
              nodeName: name,
              nodeType: type,
              nodePath: path,
              imageRef: stringValue(f.imageRef),
              fillIndex: idx,
              suggestedName:
                safeFilename(name) +
                (idx > 0 ? `-fill-${idx}` : "") +
                ".png",
            });
          }
        },
      );
    }
  });

  if (skippedHidden)
    truncatedReasons.push(
      `Skipped ${skippedHidden} hidden node(s). Set includeHidden=true to include them.`,
    );
  if (skippedDeep)
    truncatedReasons.push(
      `Skipped ${skippedDeep} deeply nested node(s) beyond depth 8.`,
    );

  return {
    assets,
    metadata: {
      truncated:
        truncatedReasons.length > 0 ||
        assets.length >= maxAssets,
      truncatedReasons,
      nextSteps: assets.length
        ? [
            "Use manifest nodePath values to map downloaded files back to source Figma layers.",
          ]
        : [
            "Try a different nodeId, increase maxAssets, or set includeHidden=true.",
          ],
    },
  };
}

export async function manifestEntryFromFile(
  candidate: FigmaAssetCandidate,
  filePath: string,
  url?: string | null,
  format?: FigmaAssetManifestEntry["format"],
): Promise<FigmaAssetManifestEntry> {
  let sha256hex: string | undefined;
  let bytes: number | undefined;
  try {
    const buf = await readFile(filePath);
    sha256hex = sha256(buf);
    bytes = buf.length;
  } catch {
    // File not readable — sha256/bytes remain undefined.
  }
  return {
    ...candidate,
    url: url ?? null,
    path: filePath,
    format: format ?? formatFromPath(filePath),
    sha256: sha256hex,
    bytes,
  };
}

export function manifestEntryFromUrl(
  candidate: FigmaAssetCandidate,
  url: string | null | undefined,
  format: FigmaAssetManifestEntry["format"],
): FigmaAssetManifestEntry {
  return { ...candidate, url: url ?? null, format };
}

export function sha256(value: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeFilename(value: string): string {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "figma-asset"
  );
}

function formatFromPath(
  path: string,
): FigmaAssetManifestEntry["format"] {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "png";
  if (ext === ".jpg" || ext === ".jpeg") return "jpg";
  if (ext === ".svg") return "svg";
  if (ext === ".webp") return "webp";
  return "unknown";
}

function isIconCandidate(
  record: Record<string, unknown>,
): boolean {
  const type = String(record.type ?? "").toUpperCase();
  if (type in VECTOR_TYPES) return true;
  const name = String(record.name ?? "").toLowerCase();
  if (
    name.includes("icon") ||
    name.includes("glyph") ||
    name.includes("symbol")
  )
    return true;
  return false;
}

function walk(
  node: unknown,
  includeHidden: boolean,
  visit: (
    record: Record<string, unknown>,
    path: string,
    level: number,
  ) => void,
  path = "",
  level = 0,
): void {
  const record = asRecord(node);
  if (!Object.keys(record).length) return;
  if (!includeHidden && record.visible === false) return;
  const name = String(record.name ?? "");
  const nextPath = path ? `${path} > ${name}` : name;
  visit(record, nextPath, level);
  const children = Array.isArray(record.children)
    ? record.children
    : [];
  for (const child of children) {
    walk(child, includeHidden, visit, nextPath, level + 1);
  }
}
