/** The value `text` holds as JSON, or undefined when it holds none. */
export function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
