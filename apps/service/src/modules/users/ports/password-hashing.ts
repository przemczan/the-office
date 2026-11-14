/**
 * Passwords kept only as hashes (spec §6): a random salt, the parameters kept with the hash so they
 * can rise later, compared in constant time.
 */
export abstract class PasswordHashing {
  abstract hash(password: string): Promise<string>;

  /** Whether the password is the one hashed; a hash it can't read is never matched. */
  abstract matches(password: string, hash: string): Promise<boolean>;
}
