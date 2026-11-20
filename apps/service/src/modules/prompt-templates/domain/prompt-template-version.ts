import type { UserRef } from "./user.js";

/** A version of a template's text as a save or a reset makes it: `null` text is the default. */
export interface PromptTemplateChange {
  readonly version: number;
  readonly text: string | null;
}

/** One saved version of a template's text, with who saved it and when. */
export interface PromptTemplateVersion extends PromptTemplateChange {
  readonly key: string;
  readonly savedAt: Date;
  readonly savedBy: UserRef;
}

/**
 * The version `text` makes after the current one, or undefined when the template has that text
 * already. `null`, or the default text itself, is kept as `null`, so the template follows the
 * default a later release ships.
 */
export function versionAfter(
  current: PromptTemplateChange | undefined,
  text: string | null,
  defaultText: string,
): PromptTemplateChange | undefined {
  const stored = text === defaultText ? null : text;
  if (stored === (current?.text ?? null)) return undefined;
  return { version: (current?.version ?? 0) + 1, text: stored };
}
