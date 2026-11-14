import { randomInt } from "node:crypto";
import {
  ONE_TIME_PASSWORD_ALPHABET,
  ONE_TIME_PASSWORD_LENGTH,
  groupedOneTimePassword,
} from "../domain/one-time-password.js";

/** A new random one-time password, grouped as shown; it is hashed as typed, without the dashes. */
export function newOneTimePassword(): string {
  const characters = Array.from(
    { length: ONE_TIME_PASSWORD_LENGTH },
    () => ONE_TIME_PASSWORD_ALPHABET[randomInt(ONE_TIME_PASSWORD_ALPHABET.length)],
  ).join("");
  return groupedOneTimePassword(characters);
}
