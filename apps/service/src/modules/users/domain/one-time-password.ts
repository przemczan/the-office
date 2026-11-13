/**
 * A one-time password's characters (spec §2.10 Defaults): capitals and digits without the
 * look-alikes 0, O, 1, I and L, so it reads out and types back without doubt.
 */
export const ONE_TIME_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ONE_TIME_PASSWORD_LENGTH = 16;
const GROUP_LENGTH = 4;

/** The one-time password as shown, in groups of four: `ABCD-EFGH-JKMN-PQRS`. */
export function groupedOneTimePassword(characters: string): string {
  return (characters.match(new RegExp(`.{1,${GROUP_LENGTH}}`, "g")) ?? []).join("-");
}

/**
 * A one-time password as it is hashed and checked: its characters alone, in capitals, so it works
 * typed with or without the dashes, in either case.
 */
export function oneTimePasswordAsTyped(typed: string): string {
  return typed.replace(/[\s-]/g, "").toUpperCase();
}
