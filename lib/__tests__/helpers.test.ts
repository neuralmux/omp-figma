import { describe, expect, it } from "bun:test";
import {
  asRecord,
  clampInteger,
  getNestedArray,
  numberValue,
  stringValue,
  uniqueStrings,
} from "../helpers.js";

// ---------------------------------------------------------------------------
// asRecord
// ---------------------------------------------------------------------------
describe("asRecord", () => {
  it("returns the same object for a plain object", () => {
    const obj = { a: 1 };
    expect(asRecord(obj)).toBe(obj);
  });

  it("returns empty object for null", () => {
    expect(asRecord(null)).toEqual({});
  });

  it("returns empty object for undefined", () => {
    expect(asRecord(undefined)).toEqual({});
  });

  it("returns empty object for a string", () => {
    expect(asRecord("hello")).toEqual({});
  });

  it("returns empty object for a number", () => {
    expect(asRecord(42)).toEqual({});
  });

  it("returns empty object for an array", () => {
    expect(asRecord([1, 2, 3])).toEqual({});
  });

  it("returns empty object for a function", () => {
    expect(asRecord(() => {})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// stringValue
// ---------------------------------------------------------------------------
describe("stringValue", () => {
  it("returns the string for a string value", () => {
    expect(stringValue("hello")).toBe("hello");
  });

  it("returns undefined for a number", () => {
    expect(stringValue(42)).toBeUndefined();
  });

  it("returns undefined for an object", () => {
    expect(stringValue({})).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(stringValue(null)).toBeUndefined();
  });

  it("returns undefined for undefined", () => {
    expect(stringValue(undefined)).toBeUndefined();
  });

  it("returns empty string for empty string", () => {
    expect(stringValue("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// numberValue
// ---------------------------------------------------------------------------
describe("numberValue", () => {
  it("returns the number for a finite number", () => {
    expect(numberValue(42)).toBe(42);
  });

  it("returns 0 for zero", () => {
    expect(numberValue(0)).toBe(0);
  });

  it("returns undefined for NaN", () => {
    expect(numberValue(NaN)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(numberValue(Infinity)).toBeUndefined();
  });

  it("returns undefined for -Infinity", () => {
    expect(numberValue(-Infinity)).toBeUndefined();
  });

  it("returns undefined for a string", () => {
    expect(numberValue("42")).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(numberValue(null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// clampInteger
// ---------------------------------------------------------------------------
describe("clampInteger", () => {
  it("returns the value when within range", () => {
    expect(clampInteger(5, 1, 10)).toBe(5);
  });

  it("returns min when value is below range", () => {
    expect(clampInteger(0, 1, 10)).toBe(1);
  });

  it("returns max when value is above range", () => {
    expect(clampInteger(100, 1, 10)).toBe(10);
  });

  it("truncates floats to integers", () => {
    expect(clampInteger(5.9, 1, 10)).toBe(5);
  });

  it("returns min equals max when range is a single value", () => {
    expect(clampInteger(42, 7, 7)).toBe(7);
  });

  it("handles negative ranges", () => {
    expect(clampInteger(0, -5, -1)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// getNestedArray
// ---------------------------------------------------------------------------
describe("getNestedArray", () => {
  it("returns the array at a single-segment path", () => {
    expect(getNestedArray({ items: [1, 2] }, ["items"])).toEqual([1, 2]);
  });

  it("returns the array at a nested path", () => {
    expect(
      getNestedArray({ meta: { items: [1, 2] } }, ["meta", "items"]),
    ).toEqual([1, 2]);
  });

  it("returns empty array when a segment is missing", () => {
    expect(getNestedArray({}, ["missing"])).toEqual([]);
  });

  it("returns empty array when the value at path is not an array", () => {
    expect(getNestedArray({ items: "not-array" }, ["items"])).toEqual([]);
  });

  it("returns empty array when the value at path is null", () => {
    expect(getNestedArray({ items: null }, ["items"])).toEqual([]);
  });

  it("returns empty array for null root", () => {
    expect(getNestedArray(null, ["anything"])).toEqual([]);
  });

  it("returns the root when path is empty (root is array)", () => {
    expect(getNestedArray([1, 2, 3], [])).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// uniqueStrings
// ---------------------------------------------------------------------------
describe("uniqueStrings", () => {
  it("deduplicates strings", () => {
    expect(uniqueStrings(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("returns the same array when there are no duplicates", () => {
    expect(uniqueStrings(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for empty input", () => {
    expect(uniqueStrings([])).toEqual([]);
  });

  it("preserves insertion order (first occurrence wins)", () => {
    expect(uniqueStrings(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
  });
});
