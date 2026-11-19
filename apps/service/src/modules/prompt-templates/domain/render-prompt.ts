import Mustache from "mustache";

/** Writes a value as it is: a prompt is plain text, never HTML. */
const ESCAPE_NOTHING = { escape: (value: unknown): string => String(value) };

/**
 * Renders a checked text with its values. The escape is given per call, so Mustache's global one
 * stays as it is for any other use; there are no partials.
 */
export function renderPrompt(text: string, values: object): string {
  return Mustache.render(text, values, {}, ESCAPE_NOTHING);
}
