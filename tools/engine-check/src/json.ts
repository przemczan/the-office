export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface JsonDifference {
  readonly path: string;
  readonly expected: Json | undefined;
  readonly observed: Json | undefined;
}

export function diffJson(
  expected: Json | undefined,
  observed: Json | undefined,
  path = "$",
): JsonDifference[] {
  if (isObject(expected) && isObject(observed)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(observed)])].toSorted();
    return keys.flatMap((key) => diffJson(expected[key], observed[key], `${path}.${key}`));
  }
  if (Array.isArray(expected) && Array.isArray(observed) && expected.length === observed.length) {
    return expected.flatMap((item, index) => diffJson(item, observed[index], `${path}[${index}]`));
  }
  return JSON.stringify(expected) === JSON.stringify(observed)
    ? []
    : [{ path, expected, observed }];
}

function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
