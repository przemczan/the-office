/** One saved text of the Office instructions; a session records the number it started with. */
export interface OfficeInstructionsVersion {
  readonly version: number;
  readonly text: string;
}

/** What a session has when nothing is saved, or when it started before there were any. */
export const NO_OFFICE_INSTRUCTIONS: OfficeInstructionsVersion = { version: 0, text: "" };

/** The version the text makes after the current one; undefined when it is the current text. */
export function versionAfter(
  current: OfficeInstructionsVersion,
  text: string,
): OfficeInstructionsVersion | undefined {
  return text === current.text ? undefined : { version: current.version + 1, text };
}
