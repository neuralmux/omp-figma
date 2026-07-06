import { describe, expect, it } from "bun:test";
import { sanitizeDetails } from "../detail-sanitizer.js";

// ---------------------------------------------------------------------------
// sanitizeDetails
// ---------------------------------------------------------------------------
describe("sanitizeDetails", () => {
  // --- pass-through behaviour ---
  it("returns a copy with scalar values unchanged", () => {
    const input = { name: "Alice", age: 30, active: true };
    const result = sanitizeDetails(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input); // shallow copy
  });

  it("does not mutate the original object", () => {
    const input = { children: null, name: "frame" };
    sanitizeDetails(input);
    expect(input.children).toBeNull();
    expect(input.name).toBe("frame");
  });

  // --- known array fields ---
  it("replaces null children with []", () => {
    expect(sanitizeDetails({ children: null })).toEqual({
      children: [],
    });
  });

  it("replaces undefined children with []", () => {
    expect(sanitizeDetails({ children: undefined })).toEqual({
      children: [],
    });
  });

  it("keeps existing array values unchanged", () => {
    const input = { children: [{ id: "x" }, { id: "y" }] };
    const result = sanitizeDetails(input);
    expect(result.children).toBe(input.children); // same reference
    expect(result.children).toEqual([{ id: "x" }, { id: "y" }]);
  });

  // --- coverage of key known fields ---
  it.each([
    "items",
    "children",
    "text",
    "visibleText",
    "truncatedReasons",
    "nextSteps",
    "texts",
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
    "matches",
    "suggestedFiles",
    "suggestedProps",
    "statesAndVariants",
    "accessibilityRequirements",
    "tokenDependencies",
    "assetDependencies",
    "savedFiles",
    "assetTypes",
    "recommendations",
    "resolved",
    "unresolved",
    "warnings",
    "notes",
    "modes",
    "grids",
    "variants",
    "fills",
    "strokes",
    "effects",
    "layoutGrids",
    "boundVariables",
    "componentProperties",
    "preferredValues",
    "collections",
    "images",
  ])("replaces null %s with []", (field) => {
    const result = sanitizeDetails({ [field]: null });
    expect(result[field]).toEqual([]);
  });

  // --- unknown / scalar fields are left alone ---
  it("leaves null in unknown fields as-is", () => {
    expect(sanitizeDetails({ unknownField: null })).toEqual({
      unknownField: null,
    });
  });

  it("leaves undefined in unknown fields as-is", () => {
    expect(sanitizeDetails({ unknownField: undefined })).toEqual({
      unknownField: undefined,
    });
  });

  it("passes through nested objects unchanged", () => {
    const nested = { a: 1 };
    const result = sanitizeDetails({ items: nested });
    expect(result.items).toBe(nested);
  });

  // --- edge cases ---
  it("returns empty object for empty input", () => {
    expect(sanitizeDetails({})).toEqual({});
  });

  it("handles mixed known/unknown null fields", () => {
    const result = sanitizeDetails({
      children: null,
      unknownField: null,
      name: "frame",
      fills: undefined,
    });
    expect(result).toEqual({
      children: [],
      unknownField: null,
      name: "frame",
      fills: [],
    });
  });
});
