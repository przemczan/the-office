import type { SignedInDevice } from "../domain/signed-in-device.js";

/** Where signed-in devices are kept, each by its token's hash. */
export abstract class SignedInDeviceRepository {
  abstract add(device: SignedInDevice): Promise<void>;

  /** The device with this token's hash, while its user isn't removed. */
  abstract findByTokenHash(tokenHash: string): Promise<SignedInDevice | undefined>;

  /** The devices of these ids that are still kept. */
  abstract findAll(ids: readonly string[]): Promise<readonly SignedInDevice[]>;

  /** The user's devices, the most recently used first. */
  abstract listOf(userId: string): Promise<readonly SignedInDevice[]>;

  /** Writes its last use and expiry. */
  abstract saveLastSeen(device: SignedInDevice): Promise<void>;

  /** Forgets the user's device; says whether they had it. */
  abstract remove(userId: string, id: string): Promise<boolean>;

  /** Forgets every device of the user but `except`, and answers their ids. */
  abstract removeAllOf(userId: string, except?: string): Promise<readonly string[]>;
}
