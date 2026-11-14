/** A query parameter, such as one a provider sent the browser back with, when it is a non-empty text. */
export function textOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
