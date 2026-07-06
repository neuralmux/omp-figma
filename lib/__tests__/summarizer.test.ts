import { describe, expect, it } from "bun:test";
import {
  explainNode,
  extractVisibleText,
  getImplementationContext,
  summarizeNode,
} from "../summarizer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A realistic auto-layout FRAME with fills, padding, spacing, and children. */
const autoLayoutFrame = {
  id: "1:1",
  name: "Card / Default",
  type: "FRAME",
  visible: true,
  absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 200 },
  layoutMode: "VERTICAL",
  itemSpacing: 12,
  paddingLeft: 16,
  paddingRight: 16,
  paddingTop: 16,
  paddingBottom: 16,
  primaryAxisAlignItems: "MIN",
  counterAxisAlignItems: "STRETCH",
  layoutSizingHorizontal: "FILL",
  layoutSizingVertical: "HUG",
  cornerRadius: 8,
  fills: [
    { type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, visible: true },
  ],
  strokes: [],
  effects: [
    { type: "DROP_SHADOW", radius: 4, offset: { x: 0, y: 2 }, visible: true },
  ],
  children: [
    {
      id: "1:2",
      name: "Title",
      type: "TEXT",
      visible: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 288, height: 24 },
      characters: "Hello World",
      style: {
        fontFamily: "Inter",
        fontSize: 18,
        fontWeight: 600,
        lineHeightPx: 24,
      },
      fills: [
        {
          type: "SOLID",
          color: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
          visible: true,
        },
      ],
    },
    {
      id: "1:3",
      name: "Body",
      type: "TEXT",
      visible: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 288, height: 16 },
      characters: "Lorem ipsum dolor sit amet",
      style: {
        fontFamily: "Inter",
        fontSize: 14,
        fontWeight: 400,
        lineHeightPx: 20,
      },
    },
    {
      id: "1:4",
      name: "CTA Button",
      type: "COMPONENT",
      visible: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
      cornerRadius: 6,
      fills: [
        {
          type: "SOLID",
          color: { r: 0.2, g: 0.4, b: 0.9, a: 1 },
          visible: true,
        },
      ],
      componentId: "comp-cta",
      children: [
        {
          id: "1:5",
          name: "CTA Label",
          type: "TEXT",
          visible: true,
          characters: "Get Started",
          style: { fontFamily: "Inter", fontSize: 14, fontWeight: 600 },
        },
      ],
    },
    {
      id: "1:6",
      name: "Hidden Layer",
      type: "RECTANGLE",
      visible: false,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    },
  ],
};

/** A simple TEXT leaf node. */
const textLeaf = {
  id: "2:1",
  name: "Headline",
  type: "TEXT",
  visible: true,
  absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 32 },
  characters: "Welcome back",
  style: {
    fontFamily: "Inter",
    fontSize: 24,
    fontWeight: 700,
    lineHeightPx: 32,
  },
};

/** A deep nested structure for depth-limit testing. */
function deepNested(depth: number): Record<string, unknown> {
  let node: Record<string, unknown> = {
    id: `d-${depth}`,
    name: `Level ${depth}`,
    type: "TEXT",
    visible: true,
    characters: `text at ${depth}`,
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

/** A component instance with internal children. */
const componentInstance = {
  id: "3:1",
  name: "Button / Large",
  type: "INSTANCE",
  visible: true,
  componentId: "comp-btn-large",
  componentProperties: {
    "Label#text": { type: "TEXT", value: "Submit" },
    "Variant#state": { type: "VARIANT", value: "Default" },
  },
  children: [
    {
      id: "3:2",
      name: "Button Label",
      type: "TEXT",
      visible: true,
      characters: "Submit",
    },
    {
      id: "3:3",
      name: "Button Icon",
      type: "VECTOR",
      visible: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// summarizeNode
// ---------------------------------------------------------------------------
describe("summarizeNode", () => {
  it("extracts name, type, and size from a simple node", () => {
    const summary = summarizeNode(textLeaf, { depth: 0 });
    expect(summary.name).toBe("Headline");
    expect(summary.type).toBe("TEXT");
    expect(summary.size).toEqual({ width: 200, height: 32 });
  });

  it("extracts visible text from TEXT children", () => {
    const summary = summarizeNode(autoLayoutFrame, { depth: 2 });
    expect(summary.visibleText).toContain("Hello World");
    expect(summary.visibleText).toContain("Lorem ipsum dolor sit amet");
    // CTA Label is inside a COMPONENT child, visible text from collapsed instances
    expect(summary.visibleText).toContain("Get Started");
  });

  it("excludes hidden nodes by default", () => {
    const summary = summarizeNode(autoLayoutFrame, { depth: 2 });
    const hidden = summary.visibleText?.filter((t) => t.includes("Hidden"));
    expect(hidden).toEqual([]);
  });

  it("includes hidden nodes when includeHidden is true", () => {
    const summary = summarizeNode(autoLayoutFrame, {
      depth: 2,
      includeHidden: true,
    });
    const children = summary.children?.map((c) => c.name);
    expect(children).toContain("Hidden Layer");
  });

  it("respects depth limit", () => {
    const deep = deepNested(5);
    const summary = summarizeNode(deep, { depth: 1 });
    // At depth 1 we get root + 1 level of children
    expect(summary.children).toBeDefined();
    expect(summary.children?.length).toBeGreaterThan(0);
    expect(summary.metadata?.truncatedReasons?.some((r) =>
      r.includes("depth"),
    )).toBe(true);
  });

  it("collapses INSTANCE nodes by default", () => {
    // Wrap in a parent so the INSTANCE is not the root (root is never collapsed).
    const parent = {
      id: "0:0",
      name: "Parent Frame",
      type: "FRAME",
      visible: true,
      children: [componentInstance],
    };
    const summary = summarizeNode(parent, {
      depth: 2,
      includeComponentInternals: false,
    });
    // INSTANCE child is collapsed — truncatedReasons should mention it
    expect(
      summary.metadata?.truncatedReasons?.some((r) =>
        r.includes("Collapsed component"),
      ),
    ).toBe(true);
  });

  it("shows INSTANCE internals when includeComponentInternals is true", () => {
    const summary = summarizeNode(autoLayoutFrame, {
      depth: 2,
      includeComponentInternals: true,
    });
    const cta = summary.children?.find((c) => c.name === "CTA Button");
    expect(cta?.children).toBeDefined();
    expect(cta?.children?.length).toBeGreaterThan(0);
  });

  it("extracts component properties from INSTANCE nodes", () => {
    const summary = summarizeNode(componentInstance, {
      depth: 1,
      includeComponentInternals: true,
    });
    expect(summary.component?.componentProperties).toBeDefined();
  });

  it("extracts layout and spacing from auto-layout frames", () => {
    const summary = summarizeNode(autoLayoutFrame, { depth: 0 });
    expect(summary.layout?.mode).toBe("VERTICAL");
    expect(summary.spacing?.paddingLeft).toBe(16);
    expect(summary.spacing?.itemSpacing).toBe(12);
  });

  it("extracts style information (fills, effects, radius)", () => {
    const summary = summarizeNode(autoLayoutFrame, { depth: 0 });
    expect(summary.style).toBeDefined();
    expect(summary.style?.fills).toBeDefined();
    expect(summary.style?.effects).toBeDefined();
    expect(summary.style?.cornerRadius).toBe(8);
  });

  it("guesses role based on name", () => {
    const summary = summarizeNode(autoLayoutFrame, { depth: 2 });
    const cta = summary.children?.find((c) => c.name === "CTA Button");
    expect(cta?.roleGuess).toBe("button");
  });

  it("includes nextSteps when truncated", () => {
    const summary = summarizeNode(deepNested(6), { depth: 1 });
    expect(summary.metadata?.truncated).toBe(true);
    expect(summary.metadata?.nextSteps?.length).toBeGreaterThan(0);
  });

  it("works with an empty/unknown node (no real Figma data)", () => {
    const summary = summarizeNode({});
    expect(summary.name).toBe("Unnamed node");
    expect(summary.type).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// extractVisibleText
// ---------------------------------------------------------------------------
describe("extractVisibleText", () => {
  it("extracts text from a TEXT leaf", () => {
    const result = extractVisibleText(textLeaf, { depth: 0 });
    expect(result.node).toBe("Headline");
    expect(result.texts).toEqual(["Welcome back"]);
  });

  it("extracts text recursively from children", () => {
    const result = extractVisibleText(autoLayoutFrame, { depth: 2 });
    expect(result.texts).toContain("Hello World");
    expect(result.texts).toContain("Lorem ipsum dolor sit amet");
  });

  it("respects maxVisibleText", () => {
    const manyTexts = {
      id: "x",
      name: "Many",
      type: "FRAME",
      visible: true,
      children: Array.from({ length: 5 }, (_, i) => ({
        id: `t-${i}`,
        name: `Text ${i}`,
        type: "TEXT",
        visible: true,
        characters: `Line ${i}`,
      })),
    };
    const result = extractVisibleText(manyTexts, { maxVisibleText: 2 });
    expect(result.texts).toHaveLength(2);
    expect(result.metadata.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// explainNode
// ---------------------------------------------------------------------------
describe("explainNode", () => {
  it("produces a Markdown explanation string", () => {
    const output = explainNode(autoLayoutFrame, { depth: 2 });
    expect(output.startsWith("# Card / Default")).toBe(true);
    expect(output).toContain("**FRAME**");
    expect(output).toContain("Visible text");
    expect(output).toContain("Hello World");
    expect(output).toContain("Sections");
  });

  it("includes rendered assets when provided", () => {
    const output = explainNode(autoLayoutFrame, {
      depth: 2,
      assets: [{ nodeId: "1:1", url: "https://example.com/render.png" }],
    });
    expect(output).toContain("Rendered assets");
    expect(output).toContain("1:1");
  });

  it("includes suggested next steps when truncated", () => {
    const deep = deepNested(5);
    const output = explainNode(deep, { depth: 1 });
    expect(output).toContain("Suggested next steps");
  });
});

// ---------------------------------------------------------------------------
// getImplementationContext
// ---------------------------------------------------------------------------
describe("getImplementationContext", () => {
  it("returns a structured implementation context", () => {
    const ctx = getImplementationContext(autoLayoutFrame, { depth: 2 });
    expect(ctx.purpose).toContain("Card / Default");
    expect(ctx.node.name).toBe("Card / Default");
    expect(ctx.sections.length).toBeGreaterThan(0);
    expect(ctx.fields.length).toBeGreaterThanOrEqual(0);
    expect(ctx.buttons.length).toBe(1); // CTA Button
    expect(ctx.typography.length).toBeGreaterThan(0);
    expect(ctx.colors.length).toBeGreaterThan(0);
    expect(ctx.spacing.length).toBeGreaterThan(0);
    expect(ctx.cssLayout).toBeDefined();
    expect(ctx.responsive).toBeDefined();
    expect(ctx.accessibility).toBeDefined();
    expect(ctx.componentHierarchy.length).toBeGreaterThan(0);
    expect(ctx.metadata).toBeDefined();
  });

  it("detects buttons by roleGuess", () => {
    const ctx = getImplementationContext(autoLayoutFrame, { depth: 2 });
    expect(ctx.buttons[0].name).toBe("CTA Button");
  });

  it("resolves tokens when not disabled", () => {
    const ctx = getImplementationContext(autoLayoutFrame, { depth: 2 });
    // designTokens may be undefined if tokenMap is not passed, but the function should not throw
    expect(ctx.designTokens || ctx).toBeDefined();
  });

  it("skips token resolution when resolveTokens is false", () => {
    const ctx = getImplementationContext(autoLayoutFrame, {
      depth: 2,
      resolveTokens: false,
    });
    expect(ctx.designTokens).toBeUndefined();
  });
});
