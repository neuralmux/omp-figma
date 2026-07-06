import { describe, expect, it } from "bun:test";
import { buildFigmaTokenMap } from "../tokens.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const empty = {};

const stylesResponse = {
  meta: {
    styles: [
      {
        node_id: "1:1",
        key: "style-key-1",
        name: "Primary / Blue",
        style_type: "FILL",
        description: "Main brand color",
      },
      {
        nodeId: "2:2", // camelCase variant
        key: "style-key-2",
        name: "Text / Heading",
        styleType: "TEXT",
      },
      {
        // No node_id/nodeId — should be skipped
        key: "orphan-key",
        name: "Orphan",
        style_type: "FILL",
      },
    ],
  },
};

const variablesResponse = {
  meta: {
    variableCollections: {
      "vc-1": { name: "Primitives", modes: [{ modeId: "m1", name: "Light" }] },
      "vc-2": { name: "Semantic" }, // no modes
    },
    variables: {
      "v-1": {
        key: "var-key-1",
        name: "color-primary",
        variableCollectionId: "vc-1",
        resolvedType: "COLOR",
      },
      "v-2": {
        key: "var-key-2",
        name: "spacing-xl",
        variable_collection_id: "vc-2", // snake_case variant
        resolved_type: "FLOAT",
      },
    },
  },
};

// camelCase alias for the top-level meta
const variablesResponseCamel = {
  meta: {
    variable_collections: { "vc-3": { name: "Tokens" } },
    variables: {
      "v-3": { name: "gap-sm", variableCollectionId: "vc-3", resolvedType: "FLOAT" },
    },
  },
};

// ---------------------------------------------------------------------------
// buildFigmaTokenMap
// ---------------------------------------------------------------------------
describe("buildFigmaTokenMap", () => {
  it("returns empty collections when given empty responses", () => {
    const map = buildFigmaTokenMap(empty, empty);
    expect(map.styles).toEqual({});
    expect(map.variables).toEqual({});
    expect(map.collections).toEqual({});
  });

  // -- styles --
  it("extracts styles keyed by node_id (snake_case)", () => {
    const map = buildFigmaTokenMap(stylesResponse, empty);
    expect(map.styles["1:1"]).toEqual({
      key: "style-key-1",
      name: "Primary / Blue",
      type: "FILL",
      description: "Main brand color",
    });
  });

  it("extracts styles keyed by nodeId (camelCase)", () => {
    const map = buildFigmaTokenMap(stylesResponse, empty);
    expect(map.styles["2:2"]).toEqual({
      key: "style-key-2",
      name: "Text / Heading",
      type: "TEXT",
      description: undefined,
    });
  });

  it("uses key as id when node_id and nodeId are both missing", () => {
    const map = buildFigmaTokenMap(stylesResponse, empty);
    expect(map.styles["orphan-key"]).toEqual({
      key: "orphan-key",
      name: "Orphan",
      type: "FILL",
      description: undefined,
    });
  });

  it("skips styles with no identifiable id", () => {
    const map = buildFigmaTokenMap(
      { meta: { styles: [{ name: "no-id" }] } },
      empty,
    );
    expect(Object.keys(map.styles)).toHaveLength(0);
  });

  // -- collections (snake_case) --
  it("extracts collections from variableCollections", () => {
    const map = buildFigmaTokenMap(empty, variablesResponse);
    expect(map.collections["vc-1"]).toEqual({
      name: "Primitives",
      modes: [{ modeId: "m1", name: "Light" }],
    });
    expect(map.collections["vc-2"]).toEqual({
      name: "Semantic",
      modes: undefined,
    });
  });

  // -- collections (camelCase alias) --
  it("extracts collections from variable_collections (camelCase fallback)", () => {
    const map = buildFigmaTokenMap(empty, variablesResponseCamel);
    expect(map.collections["vc-3"]).toEqual({ name: "Tokens", modes: undefined });
  });

  // -- variables --
  it("resolves variable names and collection names", () => {
    const map = buildFigmaTokenMap(empty, variablesResponse);
    expect(map.variables["v-1"]).toEqual({
      key: "var-key-1",
      name: "color-primary",
      collectionName: "Primitives",
      resolvedType: "COLOR",
    });
    expect(map.variables["v-2"]).toEqual({
      key: "var-key-2",
      name: "spacing-xl",
      collectionName: "Semantic",
      resolvedType: "FLOAT",
    });
  });

  it("leaves collectionName undefined when collection id is unknown", () => {
    const resp = {
      meta: {
        variables: { "v-99": { name: "orphan", variableCollectionId: "no-such" } },
      },
    };
    const map = buildFigmaTokenMap(empty, resp);
    expect(map.variables["v-99"].collectionName).toBeUndefined();
  });

  // -- fallback when meta is missing --
  it("handles variablesResponse with top-level keys (no meta wrapper)", () => {
    const map = buildFigmaTokenMap(empty, {
      variableCollections: { "vc-d": { name: "Direct" } },
      variables: { "v-d": { name: "direct-var", variableCollectionId: "vc-d" } },
    });
    expect(map.collections["vc-d"].name).toBe("Direct");
    expect(map.variables["v-d"].name).toBe("direct-var");
  });

  // -- warnings --
  it("emits warnings when no styles are found", () => {
    const map = buildFigmaTokenMap(empty, variablesResponse);
    expect(map.warnings).toContain(
      "No named styles were available to resolve style IDs.",
    );
  });

  it("emits warnings when no variables are found", () => {
    const map = buildFigmaTokenMap(stylesResponse, empty);
    expect(map.warnings).toContain(
      "No local variables were available to resolve variable IDs.",
    );
  });

  it("does not emit warnings when both exist", () => {
    const map = buildFigmaTokenMap(stylesResponse, variablesResponse);
    expect(map.warnings).toHaveLength(0);
  });
});
