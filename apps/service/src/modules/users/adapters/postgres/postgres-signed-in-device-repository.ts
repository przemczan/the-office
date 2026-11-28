import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { SignedInDevice } from "../../domain/signed-in-device.js";
import { SignedInDeviceRepository } from "../../ports/signed-in-device-repository.js";
import { signedInDevices, users } from "./users.schema.js";

type SignedInDeviceRow = typeof signedInDevices.$inferSelect;

@Injectable()
export class PostgresSignedInDeviceRepository extends SignedInDeviceRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  add(device: SignedInDevice): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      // Shared until the device is saved: a removal holding the user waits for it, then signs it
      // out; one that held them first is read here once it is done, and refuses the device.
      const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, device.userId), isNull(users.removedAt)))
        .for("share");
      if (user === undefined) return false;
      await transaction.insert(signedInDevices).values(toRow(device));
      return true;
    });
  }

  async findByTokenHash(tokenHash: string): Promise<SignedInDevice | undefined> {
    // A removed user's devices sign in nothing, even one made by a sign-in that raced the removal.
    const [row] = await this.database
      .select({ device: signedInDevices })
      .from(signedInDevices)
      .innerJoin(users, eq(users.id, signedInDevices.userId))
      .where(and(eq(signedInDevices.tokenHash, tokenHash), isNull(users.removedAt)));
    return row && toSignedInDevice(row.device);
  }

  async findAll(ids: readonly string[]): Promise<readonly SignedInDevice[]> {
    if (ids.length === 0) return [];
    const rows = await this.database
      .select({ device: signedInDevices })
      .from(signedInDevices)
      .innerJoin(users, eq(users.id, signedInDevices.userId))
      .where(and(inArray(signedInDevices.id, [...ids]), isNull(users.removedAt)));
    return rows.map((row) => toSignedInDevice(row.device));
  }

  async listOf(userId: string): Promise<readonly SignedInDevice[]> {
    const rows = await this.database
      .select()
      .from(signedInDevices)
      .where(eq(signedInDevices.userId, userId))
      .orderBy(desc(signedInDevices.lastSeenAt), desc(signedInDevices.signedInAt));
    return rows.map(toSignedInDevice);
  }

  async saveLastSeen({ id, lastSeenAt, expiresAt }: SignedInDevice): Promise<void> {
    await this.database
      .update(signedInDevices)
      .set({ lastSeenAt, expiresAt })
      .where(eq(signedInDevices.id, id));
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const removed = await this.database
      .delete(signedInDevices)
      .where(and(eq(signedInDevices.userId, userId), eq(signedInDevices.id, id)))
      .returning({ id: signedInDevices.id });
    return removed.length > 0;
  }

  async removeAllOf(userId: string, except?: string): Promise<readonly string[]> {
    const removed = await this.database
      .delete(signedInDevices)
      .where(
        and(
          eq(signedInDevices.userId, userId),
          except === undefined ? undefined : ne(signedInDevices.id, except),
        ),
      )
      .returning({ id: signedInDevices.id });
    return removed.map(({ id }) => id);
  }
}

function toRow(device: SignedInDevice): SignedInDeviceRow {
  return { ...device, userAgent: device.userAgent ?? null };
}

function toSignedInDevice(row: SignedInDeviceRow): SignedInDevice {
  return { ...row, userAgent: row.userAgent ?? undefined };
}
