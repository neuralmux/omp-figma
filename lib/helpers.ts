export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function getNestedArray(
  value: unknown,
  path: readonly string[],
): unknown[] {
  let current = value;
  for (const segment of path) current = asRecord(current)[segment];
  return Array.isArray(current) ? current : [];
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
