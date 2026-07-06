import { describe, expect, it } from "bun:test";
import {
  buildAccessibilityHints,
  buildCssLayoutHints,
  buildDesignTokenHints,
  buildFrameworkHints,
  buildResponsiveHints,
} from "../implementation.js";
import type { FigmaNodeSummary } from "../summarizer.js";
import type { FigmaTokenMap } from "../tokens.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
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
  layoutWrap: "NO_WRAP",
  layoutSizingHorizontal: "FILL",
  layoutSizingVertical: "HUG",
  constraints: { horizontal: "LEFT_RIGHT", vertical: "TOP" },
  children: [],
};

const freeformFrame = {
  id: "2:1",
  name: "Freeform",
  type: "FRAME",
  visible: true,
  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
  children: [],
};

const withGrids = {
  id: "3:1",
  name: "Grid",
  type: "FRAME",
  visible: true,
  layoutMode: "HORIZONTAL",
  children: [],
  layoutGrids: [
    { pattern: "COLUMNS", count: 12, gutterSize: 16, alignment: "STRETCH" },
  ],
};

const summaryButton: FigmaNodeSummary = {
  id: "b-1",
  name: "Submit Button",
  type: "COMPONENT",
  text: ["Submit"],
  visibleText: ["Submit"],
  roleGuess: "button",
};

const summaryInput: FigmaNodeSummary = {
  id: "i-1",
  name: "Email Input",
  type: "COMPONENT",
  text: ["Enter email"],
  visibleText: ["Enter email"],
  roleGuess: "form-control",
};

const summaryHeading: FigmaNodeSummary = {
  id: "h-1",
  name: "Page Title",
  type: "TEXT",
  text: ["Welcome"],
  visibleText: ["Welcome"],
  roleGuess: "heading",
};

const summaryWithChildren: FigmaNodeSummary = {
  id: "root",
  name: "Form",
  type: "FRAME",
  visibleText: ["Submit", "Enter email", "Welcome"],
  children: [summaryButton, summaryInput, summaryHeading],
};

const emptyTokenMap: FigmaTokenMap = {
  styles: {},
  variables: {},
  collections: {},
  warnings: [],
};

const populatedTokenMap: FigmaTokenMap = {
  styles: {
    "s-1": { key: "k1", name: "Blue/500", type: "FILL" },
  },
  variables: {
    "v-1": { key: "vk1", name: "color-primary", collectionName: "Primitives" },
  },
  collections: { "c-1": { name: "Primitives" } },
  warnings: [],
};

// ---------------------------------------------------------------------------
// buildCssLayoutHints
// ---------------------------------------------------------------------------
describe("buildCssLayoutHints", () => {
  it("returns flexbox hints for auto-layout vertical frames", () => {
    const hints = buildCssLayoutHints(autoLayoutFrame);
    expect(hints.css.display).toBe("flex");
    expect(hints.css.flexDirection).toBe("column");
    expect(hints.css.gap).toBe("12px");
    expect(hints.css.padding).toBe("16px 16px 16px 16px");
    expect(hints.css.justifyContent).toBe("flex-start");
    expect(hints.css.alignItems).toBe("stretch");
    expect(hints.nodeId).toBe("1:1");
  });

  it("returns flexbox hints for auto-layout horizontal frames", () => {
    const hints = buildCssLayoutHints(withGrids);
    expect(hints.css.display).toBe("flex");
    expect(hints.css.flexDirection).toBe("row");
  });

  it("returns position:relative for freeform frames", () => {
    const hints = buildCssLayoutHints(freeformFrame);
    expect(hints.css.position).toBe("relative");
    expect(hints.notes).toEqual(
      expect.arrayContaining([expect.stringContaining("auto-layout")]),
    );
  });

  it("includes layout grid hints", () => {
    const hints = buildCssLayoutHints(withGrids);
    expect(hints.css.layoutGrids).toBeDefined();
    expect(hints.notes).toEqual(
      expect.arrayContaining([expect.stringContaining("grid")]),
    );
  });

  it("returns sizing info", () => {
    const hints = buildCssLayoutHints(autoLayoutFrame);
    expect(hints.sizing.width).toBe(320);
    expect(hints.sizing.height).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// buildResponsiveHints
// ---------------------------------------------------------------------------
describe("buildResponsiveHints", () => {
  it("recommends stretch for LEFT_RIGHT constraints", () => {
    const hints = buildResponsiveHints(autoLayoutFrame);
    expect(hints.length).toBeGreaterThan(0);
    expect(
      hints.some(
        (h) =>
          Array.isArray(h.recommendations) &&
          (h.recommendations as string[]).some((r) =>
            r.includes("width: 100%"),
          ),
      ),
    ).toBe(true);
  });

  it("returns empty array for nodes without constraints", () => {
    const hints = buildResponsiveHints(freeformFrame);
    expect(hints).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildAccessibilityHints
// ---------------------------------------------------------------------------
describe("buildAccessibilityHints", () => {
  it("assigns button role/tag for button nodes", () => {
    const hints = buildAccessibilityHints(summaryWithChildren);
    const buttonHint = hints.find((h) => h.id === "b-1");
    expect(buttonHint?.role).toBe("button");
    expect(buttonHint?.suggestedTag).toBe("button");
  });

  it("assigns textbox role/tag for input nodes", () => {
    const hints = buildAccessibilityHints(summaryWithChildren);
    const inputHint = hints.find((h) => h.id === "i-1");
    expect(inputHint?.role).toBe("textbox");
    expect(inputHint?.suggestedTag).toBe("input");
  });

  it("assigns heading role/tag for heading nodes", () => {
    const hints = buildAccessibilityHints(summaryWithChildren);
    const headingHint = hints.find((h) => h.id === "h-1");
    expect(headingHint?.role).toBe("heading");
    expect(headingHint?.suggestedTag).toBe("h2");
  });
});

// ---------------------------------------------------------------------------
// buildDesignTokenHints
// ---------------------------------------------------------------------------
describe("buildDesignTokenHints", () => {
  it("returns empty resolved/unresolved for nodes without styles", () => {
    const hints = buildDesignTokenHints(freeformFrame, populatedTokenMap);
    expect(hints.resolved).toHaveLength(0);
    expect(hints.unresolved).toHaveLength(0);
  });

  it("warns when tokenMap is absent", () => {
    const hints = buildDesignTokenHints(freeformFrame);
    expect(hints.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Token resolution")]),
    );
  });

  it("resolves styles when present", () => {
    const nodeWithStyles = {
      ...autoLayoutFrame,
      styles: { fill: "s-1" }, // Figma node with a style reference
    };
    const hints = buildDesignTokenHints(nodeWithStyles, populatedTokenMap);
    expect(hints.resolved.length).toBe(1);
    expect((hints.resolved[0] as Record<string, unknown>).name).toBe("Blue/500");
  });

  it("resolves bound variables", () => {
    const nodeWithVars = {
      ...autoLayoutFrame,
      boundVariables: { fills: [{ id: "v-1", type: "VARIABLE_ALIAS" }] },
    };
    const hints = buildDesignTokenHints(nodeWithVars, populatedTokenMap);
    expect(hints.resolved.length).toBe(1);
    expect((hints.resolved[0] as Record<string, unknown>).name).toBe(
      "color-primary",
    );
  });

  it("marks unmatched ids as unresolved", () => {
    const nodeWithUnknown = {
      ...autoLayoutFrame,
      styles: { fill: "unknown-999" },
    };
    const hints = buildDesignTokenHints(nodeWithUnknown, populatedTokenMap);
    expect(hints.unresolved).toContain("unknown-999");
  });
});

// ---------------------------------------------------------------------------
// buildFrameworkHints
// ---------------------------------------------------------------------------
describe("buildFrameworkHints", () => {
  it("returns undefined when no framework/styling options are set", () => {
    const hints = buildFrameworkHints(summaryWithChildren, {});
    expect(hints).toBeUndefined();
  });

  it("returns framework hints for React + CSS", () => {
    const hints = buildFrameworkHints(summaryWithChildren, {
      framework: "react",
      styling: "css",
    });
    expect(hints?.framework).toBe("react");
    expect(hints?.styling).toBe("css");
    expect(hints?.componentName).toBe("Form");
    expect(hints?.fileHints).toEqual(["Form.tsx", "Form.styles.ts"]);
  });

  it("includes code snippet when requested", () => {
    const hints = buildFrameworkHints(summaryWithChildren, {
      framework: "react",
      styling: "css",
      includeCodeSnippets: true,
    });
    expect(hints?.snippet).toBeDefined();
    expect(typeof hints?.snippet).toBe("string");
    expect(hints?.snippet).toContain("Form");
  });

  it("returns HTML file hints for HTML framework", () => {
    const hints = buildFrameworkHints(summaryWithChildren, {
      framework: "html",
    });
    expect(hints?.componentName).toBe("Form");
    expect(hints?.fileHints).toEqual(["form.html", "form.css"]);
  });

  it("returns styled-components snippet for styled-components", () => {
    const hints = buildFrameworkHints(summaryWithChildren, {
      framework: "react",
      styling: "styled-components",
      includeCodeSnippets: true,
    });
    expect(hints?.snippet).toContain("styled.section");
  });
});
