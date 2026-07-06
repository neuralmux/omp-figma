import { describe, expect, it } from "bun:test";
import { buildComponentImplementationHints } from "../component-hints.js";
import type { FigmaImplementationContext, FigmaNodeSummary } from "../summarizer.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const summary: FigmaNodeSummary = {
  id: "1:1",
  name: "Button / Primary",
  type: "COMPONENT",
  visibleText: ["Click me"],
  roleGuess: "button",
  children: [
    {
      id: "1:2",
      name: "Icon",
      type: "VECTOR",
      component: {
        componentProperties: {
          "Icon#variant": { type: "VARIANT", value: "Arrow" },
        },
      },
    },
  ],
};

const implementationCtx: FigmaImplementationContext = {
  purpose: "Button / Primary appears to be a component for: Click me",
  node: summary,
  sections: [
    { id: "1:2", name: "Icon", type: "VECTOR" },
  ],
  fields: [],
  buttons: [{ id: "1:1", name: "Button / Primary", text: ["Click me"] }],
  layoutMeasurements: { size: { width: 120, height: 40 } },
  typography: [
    { path: "Button / Primary", fontFamily: "Inter", fontSize: 14 },
  ],
  colors: [
    { path: "Button / Primary", source: "fills", hex: "#3366ff" },
  ],
  spacing: [],
  cssLayout: { display: "flex" },
  responsive: [{ id: "1:1", name: "Button / Primary", recommendations: ["flex"] }],
  accessibility: [
    { id: "1:1", name: "Button / Primary", role: "button", suggestedTag: "button" },
  ],
  designTokens: {
    resolved: [
      { path: "Button / Primary", property: "fill", id: "s-1", kind: "style", name: "Blue/500" },
    ],
    unresolved: [],
    warnings: [],
  },
  componentHierarchy: [summary],
  assets: [{ nodeId: "1:1", url: "https://example.com/render.png" }],
  metadata: { truncated: false, truncatedReasons: [], nextSteps: [] },
};

const codeConnectStub = {
  rootDir: "/app",
  matches: [
    { path: "src/Button.tsx", line: 5, kind: "figma-connect" as const, preview: "figma.connect(..." },
  ],
  metadata: { truncated: false, truncatedReasons: [], nextSteps: [] },
};

// ---------------------------------------------------------------------------
// buildComponentImplementationHints
// ---------------------------------------------------------------------------
describe("buildComponentImplementationHints", () => {
  it("produces component name in PascalCase", () => {
    const hints = buildComponentImplementationHints(summary, implementationCtx);
    expect(hints.componentName).toBe("ButtonPrimary");
  });

  it("infers children prop from visible text", () => {
    const hints = buildComponentImplementationHints(summary, implementationCtx);
    const childrenProp = hints.suggestedProps.find((p) => p.name === "children");
    expect(childrenProp).toBeDefined();
    expect(childrenProp?.type).toBe("ReactNode/string");
  });

  it("infers onClick prop from button roleGuess", () => {
    const hints = buildComponentImplementationHints(summary, implementationCtx);
    const onClickProp = hints.suggestedProps.find((p) => p.name === "onClick");
    expect(onClickProp).toBeDefined();
  });

  it("collects variant properties from children", () => {
    const hints = buildComponentImplementationHints(summary, implementationCtx);
    expect(hints.statesAndVariants.length).toBeGreaterThan(0);
    expect(hints.statesAndVariants[0].nodeName).toBe("Icon");
  });

  it("includes accessibility requirements", () => {
    const hints = buildComponentImplementationHints(summary, implementationCtx);
    expect(hints.accessibilityRequirements.length).toBe(1);
    expect(hints.accessibilityRequirements[0].role).toBe("button");
  });

  it("includes token dependencies", () => {
    const hints = buildComponentImplementationHints(summary, implementationCtx);
    expect(hints.tokenDependencies.length).toBe(1);
    expect(hints.tokenDependencies[0].name).toBe("Blue/500");
  });

  it("includes asset dependencies", () => {
    const hints = buildComponentImplementationHints(summary, implementationCtx);
    expect(hints.assetDependencies.length).toBe(1);
    expect(hints.assetDependencies[0].nodeId).toBe("1:1");
  });

  it("includes code connect results when requested", () => {
    const hints = buildComponentImplementationHints(
      summary,
      implementationCtx,
      { includeCodeConnect: true },
      codeConnectStub,
    );
    expect(hints.codeConnect?.matches).toHaveLength(1);
  });

  it("omits code connect when includeCodeConnect is false", () => {
    const hints = buildComponentImplementationHints(
      summary,
      implementationCtx,
      { includeCodeConnect: false },
      codeConnectStub,
    );
    expect(hints.codeConnect).toBeUndefined();
  });

  it("includes framework hints", () => {
    const hints = buildComponentImplementationHints(
      summary,
      implementationCtx,
      { framework: "react", styling: "css" },
    );
    expect(hints.frameworkHints).toBeDefined();
    expect(hints.frameworkHints?.framework).toBe("react");
  });

  it("includes suggested files from framework hints or fallback", () => {
    const hints = buildComponentImplementationHints(summary, implementationCtx);
    expect(hints.suggestedFiles).toContain("ButtonPrimary.tsx");
  });

  it("includes metadata with nextSteps", () => {
    const hints = buildComponentImplementationHints(summary, implementationCtx);
    expect(hints.metadata.nextSteps.length).toBeGreaterThan(0);
  });

  it("adds code connect note to nextSteps when no matches found", () => {
    const hints = buildComponentImplementationHints(
      summary,
      implementationCtx,
      { includeCodeConnect: true },
      { ...codeConnectStub, matches: [] },
    );
    expect(
      hints.metadata.nextSteps.some((s) =>
        s.includes("Code Connect"),
      ),
    ).toBe(true);
  });

  it("handles empty summary name gracefully", () => {
    const emptyName: FigmaNodeSummary = { ...summary, name: "" };
    const hints = buildComponentImplementationHints(emptyName, implementationCtx);
    expect(hints.componentName).toBe("FigmaComponent");
  });
});
