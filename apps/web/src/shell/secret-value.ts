/** What saving does with a secret value: kept as it is, a new one, or none. */
export type SecretOnSave = "kept-set" | "kept-none" | "new" | "removed";

/**
 * `typed` is the value as saving takes it: undefined keeps the one kept, empty removes it. `set`
 * says whether a value is kept now.
 */
export function secretOnSave(typed: string | undefined, set: boolean): SecretOnSave {
  if (typed === undefined) return set ? "kept-set" : "kept-none";
  if (typed !== "") return "new";
  return set ? "removed" : "kept-none";
}

export const SECRET_ON_SAVE_WORDS: Readonly<Record<SecretOnSave, string>> = {
  "kept-set": "A value is set. It is never shown; type a new one to replace it.",
  "kept-none": "No value is set.",
  new: "The value you typed is kept on Save.",
  removed: "The value is removed on Save.",
};
