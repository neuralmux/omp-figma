/**
 * Known array property names from Figma result types that are consumed by the
 * OMP UI renderer and iterated with [...].  When a field in this set is
 * null-ish in a tool result it is replaced with [] so that spread and
 * iteration never throw "Spread syntax requires ...iterable".
 */
const RESULT_ARRAY_FIELDS = new Set([
  // jsonToolResult wrapper fields
  "items",
  // FigmaNodeSummary / hierarchy
  "children",
  "text",
  "visibleText",
  // FigmaSummaryMetadata
  "truncatedReasons",
  "nextSteps",
  // FigmaTextExtractionResult
  "texts",
  // FigmaImplementationContext
  "sections",
  "fields",
  "buttons",
  "typography",
  "colors",
  "spacing",
  "responsive",
  "accessibility",
  "componentHierarchy",
  "assets",
  // FigmaNodeSearchResult
  "matches",
  // CodeConnectScanResult (also uses "matches")
  // FigmaComponentImplementationHints
  "suggestedFiles",
  "suggestedProps",
  "statesAndVariants",
  "accessibilityRequirements",
  "tokenDependencies",
  "assetDependencies",
  // RenderNodesResult
  "savedFiles",
  // FigmaExtractAssetsResult
  "assetTypes",
  // Design token hints
  "recommendations",
  "resolved",
  "unresolved",
  // FigmaTokenMap
  "warnings",
  // Framework hints / layout
  "notes",
  "modes",
  "grids",
  "variants",
  // Node-level arrays from Figma API
  "fills",
  "strokes",
  "effects",
  "layoutGrids",
  "boundVariables",
  "componentProperties",
  "preferredValues",
  // Collections / top-level structure
  "collections",
  "images",
]);

/**
 * Return a shallow copy of `value` where every known array field that is
 * null or undefined is replaced with [].  This prevents the OMP UI renderer
 * from crashing with "Spread syntax requires ...iterable" when iterating
 * result details.
 */
export function sanitizeDetails(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    sanitized[key] =
      (val === null || val === undefined) && RESULT_ARRAY_FIELDS.has(key)
        ? []
        : val;
  }
  return sanitized;
}
