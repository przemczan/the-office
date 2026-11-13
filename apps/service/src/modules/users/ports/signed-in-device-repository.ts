import type { SignedInDevice } from "../domain/signed-in-device.js";

/** Where signed-in devices are kept, each by its token's hash. */
export abstract class SignedInDeviceRepository {
  abstract add(device: SignedInDevice): Promise<void>;

  abstract findByTokenHash(tokenHash: string): Promise<SignedInDevice | undefined>;

  /** The user's devices, the most recently used first. */
  abstract listOf(userId: string): Promise<readonly SignedInDevice[]>;

  /** Writes its last use and expiry. */
  abstract saveLastSeen(device: SignedInDevice): Promise<void>;

  /** Forgets the user's device; says whether they had it. */
  abstract remove(userId: string, id: string): Promise<boolean>;

  /** Forgets every device of the user, and answers their ids. */
  abstract removeAllOf(userId: string): Promise<readonly string[]>;
}
