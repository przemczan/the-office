/** A query parameter GitHub sent the browser back with, when it is a non-empty text. */
export function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
