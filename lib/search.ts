import {
  asRecord,
  clampInteger,
  stringValue,
  uniqueStrings,
} from "./helpers.js";

const VECTOR_TYPES: Record<string, true> = {
  VECTOR: true,
  BOOLEAN_OPERATION: true,
  STAR: true,
  LINE: true,
  ELLIPSE: true,
  POLYGON: true,
  REGULAR_POLYGON: true,
};

export interface FigmaFindNodesOptions {
  query: string;
  depth?: number;
  exact?: boolean;
  caseSensitive?: boolean;
  includeHidden?: boolean;
  includeVectors?: boolean;
  includeComponentInternals?: boolean;
  maxResults?: number;
}

export interface FigmaNodeSearchMatch {
  id?: string;
  name: string;
  type: string;
  path: string;
  visible: boolean;
  text?: string;
  parent?: { id?: string; name: string; type: string; path: string };
  roleHint?: string;
}

export interface FigmaNodeSearchResult {
  query: string;
  matchType: "name" | "text";
  matches: FigmaNodeSearchMatch[];
  metadata: {
    truncated: boolean;
    truncatedReasons: string[];
    nextSteps: string[];
  };
}

interface NormalizedSearchOptions
  extends Required<Omit<FigmaFindNodesOptions, "query">> {
  query: string;
}

const DEFAULT_DEPTH = 4;
const DEFAULT_MAX_RESULTS = 50;
const MAX_DEPTH = 12;

export function findNodesByName(
  node: unknown,
  options: FigmaFindNodesOptions,
): FigmaNodeSearchResult {
  return findNodes(node, normalizeOptions(options), "name");
}

export function findNodesByText(
  node: unknown,
  options: FigmaFindNodesOptions,
): FigmaNodeSearchResult {
  return findNodes(node, normalizeOptions(options), "text");
}

function findNodes(
  root: unknown,
  options: NormalizedSearchOptions,
  matchType: "name" | "text",
): FigmaNodeSearchResult {
  const matches: FigmaNodeSearchMatch[] = [];
  const truncatedReasons: string[] = [];
  let skippedHidden = 0;
  let skippedVectors = 0;
  let skippedInstances = 0;

  function visit(
    node: unknown,
    level: number,
    path: string,
    parent?: FigmaNodeSearchMatch["parent"],
  ): void {
    const record = asRecord(node);
    if (!Object.keys(record).length) return;
    const visible = record.visible !== false;
    if (!options.includeHidden && !visible) {
      skippedHidden += 1;
      return;
    }
    const type = String(record.type ?? "UNKNOWN");
    const isVector = type in VECTOR_TYPES;
    if (isVector && !options.includeVectors && level > 0) {
      skippedVectors += 1;
      return;
    }
    const name = String(record.name ?? "Unnamed node");
    const nextPath = path ? `${path} > ${name}` : name;

    const candidate =
      matchType === "name"
        ? name
        : (normalizeText(record.characters) ?? "");
    if (candidate && isMatch(candidate, options)) {
      if (matches.length < options.maxResults) {
        matches.push({
          id: stringValue(record.id),
          name,
          type,
          path: nextPath,
          visible,
          text:
            matchType === "text"
              ? candidate
              : normalizeText(record.characters),
          parent,
          roleHint: roleHint(name, candidate, type),
        });
      } else if (
        !truncatedReasons.some((r) => r.includes("maxResults"))
      ) {
        truncatedReasons.push(
          `Reached maxResults ${options.maxResults}; additional matches were omitted.`,
        );
      }
    }

    if (level >= options.depth) {
      if (
        getChildren(record).length &&
        !truncatedReasons.some((r) => r.includes("depth limit"))
      ) {
        truncatedReasons.push(
          `Reached depth limit ${options.depth}; deeper descendants were not searched.`,
        );
      }
      return;
    }
    if (
      type === "INSTANCE" &&
      !options.includeComponentInternals &&
      level > 0
    ) {
      skippedInstances += 1;
      for (const child of getChildren(record)) {
        const cr = asRecord(child);
        if (cr.type === "TEXT")
          visit(
            child,
            level + 1,
            nextPath,
            compactParent(record, nextPath),
          );
      }
      return;
    }
    for (const child of getChildren(record))
      visit(child, level + 1, nextPath, compactParent(record, nextPath));
  }

  visit(root, 0, "");

  if (skippedHidden)
    truncatedReasons.push(
      `Skipped ${skippedHidden} hidden node(s). Set includeHidden=true.`,
    );
  if (skippedVectors)
    truncatedReasons.push(
      `Skipped ${skippedVectors} vector/icon node(s). Set includeVectors=true.`,
    );
  if (skippedInstances)
    truncatedReasons.push(
      `Collapsed ${skippedInstances} component instance subtree(s). Set includeComponentInternals=true.`,
    );

  const nextSteps: string[] = [];
  if (!matches.length)
    nextSteps.push(
      "Try a broader query, disable exact matching, or search visible text instead of names.",
    );
  if (
    truncatedReasons.some((r) => r.includes("maxResults"))
  )
    nextSteps.push(
      "Raise maxResults or narrow the search with nodeId/depth.",
    );
  if (
    truncatedReasons.some((r) => r.includes("depth limit")) &&
    options.depth < MAX_DEPTH
  )
    nextSteps.push(
      `Increase depth to ${options.depth + 1} or search within a more specific nodeId.`,
    );
  if (skippedInstances)
    nextSteps.push(
      "Set includeComponentInternals=true only for a focused component instance if internal layer matches matter.",
    );

  return {
    query: options.query,
    matchType,
    matches,
    metadata: {
      truncated:
        truncatedReasons.some(
          (r) =>
            !r.startsWith("Skipped") &&
            !r.startsWith("Collapsed"),
        ) || matches.length >= options.maxResults,
      truncatedReasons: uniqueStrings(truncatedReasons),
      nextSteps,
    },
  };
}

function normalizeOptions(
  options: FigmaFindNodesOptions,
): NormalizedSearchOptions {
  return {
    query: options.query,
    depth: clampInteger(options.depth ?? DEFAULT_DEPTH, 1, MAX_DEPTH),
    exact: options.exact ?? false,
    caseSensitive: options.caseSensitive ?? false,
    includeHidden: options.includeHidden ?? false,
    includeVectors: options.includeVectors ?? false,
    includeComponentInternals:
      options.includeComponentInternals ?? false,
    maxResults: clampInteger(
      options.maxResults ?? DEFAULT_MAX_RESULTS,
      1,
      200,
    ),
  };
}

function isMatch(
  candidate: string,
  options: NormalizedSearchOptions,
): boolean {
  const haystack = options.caseSensitive
    ? candidate
    : candidate.toLowerCase();
  const needle = options.caseSensitive
    ? options.query
    : options.query.toLowerCase();
  return options.exact ? haystack === needle : haystack.includes(needle);
}

function compactParent(
  record: Record<string, unknown>,
  path: string,
): FigmaNodeSearchMatch["parent"] {
  return {
    id: stringValue(record.id),
    name: String(record.name ?? "Unnamed node"),
    type: String(record.type ?? "UNKNOWN"),
    path,
  };
}

function roleHint(
  name: string,
  text: string,
  type: string,
): string | undefined {
  const combined = `${name} ${text}`.toLowerCase();
  if (combined.includes("button")) return "button";
  if (
    combined.includes("input") ||
    combined.includes("textfield") ||
    combined.includes("text field")
  )
    return "text-input";
  if (combined.includes("checkbox")) return "checkbox";
  if (combined.includes("radio")) return "radio-button";
  if (combined.includes("select") || combined.includes("dropdown"))
    return "select";
  if (combined.includes("link")) return "link";
  if (combined.includes("icon")) return "icon";
  if (type === "TEXT" && text.trim())
    return text.length > 50 ? "paragraph" : "label";
  return undefined;
}

function getChildren(
  record: Record<string, unknown>,
): unknown[] {
  return Array.isArray(record.children) ? record.children : [];
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}
