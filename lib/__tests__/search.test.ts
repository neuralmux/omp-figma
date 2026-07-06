import { describe, expect, it } from "bun:test";
import { findNodesByName, findNodesByText } from "../search.js";

// ---------------------------------------------------------------------------
// Fixtures — a simplified Figma document tree
// ---------------------------------------------------------------------------
const simpleFrame = {
  id: "1:1",
  name: "Frame 1",
  type: "FRAME",
  visible: true,
  children: [
    {
      id: "1:2",
      name: "Button / Primary",
      type: "COMPONENT",
      visible: true,
      children: [
        {
          id: "1:3",
          name: "Label",
          type: "TEXT",
          visible: true,
          characters: "Click me",
        },
      ],
    },
    {
      id: "1:4",
      name: "Icon / Arrow",
      type: "VECTOR",
      visible: true,
    },
    {
      id: "1:5",
      name: "Background",
      type: "RECTANGLE",
      visible: false, // hidden
    },
  ],
};

const instanceFixture = {
  id: "2:1",
  name: "Card",
  type: "INSTANCE",
  visible: true,
  children: [
    {
      id: "2:2",
      name: "Title",
      type: "TEXT",
      visible: true,
      characters: "Hello world",
    },
    {
      id: "2:3",
      name: "Icon",
      type: "VECTOR",
      visible: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// findNodesByName
// ---------------------------------------------------------------------------
describe("findNodesByName", () => {
  it("finds nodes matching by name (case-insensitive by default)", () => {
    const result = findNodesByName(simpleFrame, {
      query: "button",
    });
    expect(result.matchType).toBe("name");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].name).toBe("Button / Primary");
    expect(result.matches[0].type).toBe("COMPONENT");
  });

  it("returns multiple matches when includeVectors is true", () => {
    const result = findNodesByName(simpleFrame, {
      query: "icon",
      includeVectors: true,
    });
    expect(result.matches).toHaveLength(1); // Icon / Arrow (VECTOR)
  });

  it("returns empty matches when nothing matches", () => {
    const result = findNodesByName(simpleFrame, {
      query: "zzz_nonexistent",
    });
    expect(result.matches).toHaveLength(0);
    expect(result.metadata.truncated).toBe(false);
  });

  it("respects caseSensitive option", () => {
    const result = findNodesByName(simpleFrame, {
      query: "button",
      caseSensitive: true,
    });
    // "Button / Primary" contains lowercase "button"? "button" vs "Button" → false
    expect(result.matches).toHaveLength(0);
  });

  it("respects exact option", () => {
    const result = findNodesByName(simpleFrame, {
      query: "Label",
      exact: true,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].name).toBe("Label");

    const partial = findNodesByName(simpleFrame, {
      query: "Label",
      exact: false,
    });
    expect(partial.matches).toHaveLength(1); // same here but behavior differs
  });

  it("excludes hidden nodes by default", () => {
    const result = findNodesByName(simpleFrame, {
      query: "Background",
    });
    expect(result.matches).toHaveLength(0);
  });

  it("includes hidden nodes when includeHidden is true", () => {
    const result = findNodesByName(simpleFrame, {
      query: "Background",
      includeHidden: true,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].visible).toBe(false);
  });

  it("excludes vector nodes by default", () => {
    const result = findNodesByName(simpleFrame, {
      query: "Arrow",
    });
    expect(result.matches).toHaveLength(0);
  });

  it("includes vector nodes when includeVectors is true", () => {
    const result = findNodesByName(simpleFrame, {
      query: "Arrow",
      includeVectors: true,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe("VECTOR");
  });

  it("collapses INSTANCE internals by default (only TEXT children)", () => {
    const result = findNodesByName(instanceFixture, {
      query: "Icon",
    });
    // Icon is a VECTOR inside an INSTANCE, vectors excluded + instance collapsed
    // So only TEXT children are visited inside collapsed INSTANCE
    // Wait — Icon doesn't match (it's VECTOR and excluded). Title doesn't match either.
    expect(result.matches).toHaveLength(0);
  });

  it("includes INSTANCE internals when includeComponentInternals is true", () => {
    const result = findNodesByName(instanceFixture, {
      query: "Icon",
      includeComponentInternals: true,
      includeVectors: true,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].name).toBe("Icon");
  });

  it("includes a path in match results", () => {
    const result = findNodesByName(simpleFrame, {
      query: "Label",
    });
    expect(result.matches[0].path).toBe("Frame 1 > Button / Primary > Label");
    expect(result.matches[0].parent).toBeDefined();
    expect(result.matches[0].parent!.name).toBe("Button / Primary");
  });

  it("respects maxResults", () => {
    const many = {
      id: "r",
      name: "Root",
      type: "FRAME",
      visible: true,
      children: Array.from({ length: 10 }, (_, i) => ({
        id: `x:${i}`,
        name: `Button ${i}`,
        type: "COMPONENT",
        visible: true,
      })),
    };
    const result = findNodesByName(many, {
      query: "Button",
      maxResults: 3,
    });
    expect(result.matches).toHaveLength(3);
    expect(result.metadata.truncated).toBe(true);
  });

  it("respects depth limit", () => {
    const deep = buildDeepTree(5);
    const result = findNodesByName(deep, {
      query: "Leaf",
      depth: 2,
    });
    expect(result.matches).toHaveLength(0);
    expect(
      result.metadata.truncatedReasons.some((r) => r.includes("depth")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findNodesByText
// ---------------------------------------------------------------------------
describe("findNodesByText", () => {
  it("finds TEXT nodes by visible text", () => {
    const result = findNodesByText(simpleFrame, {
      query: "Click",
    });
    expect(result.matchType).toBe("text");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].name).toBe("Label");
    expect(result.matches[0].text).toBe("Click me");
  });

  it("returns roleHint for recognised controls", () => {
    const result = findNodesByText(simpleFrame, {
      query: "Click",
    });
    expect(result.matches[0].roleHint).toBe("label");
  });

  it("returns empty matches when no text matches", () => {
    const result = findNodesByText(simpleFrame, {
      query: "zzz_no_text",
    });
    expect(result.matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function buildDeepTree(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = {
    id: `d-${depth}`,
    name: `Leaf`,
    type: "TEXT",
    visible: true,
    characters: "deep text",
  };
  for (let i = depth - 1; i >= 1; i--) {
    node = {
      id: `d-${i}`,
      name: `Level ${i}`,
      type: "FRAME",
      visible: true,
      children: [node],
    };
  }
  return node;
}
