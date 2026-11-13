import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { SignedInDevice } from "../../domain/signed-in-device.js";
import { SignedInDeviceRepository } from "../../ports/signed-in-device-repository.js";
import { signedInDevices } from "./users.schema.js";

type SignedInDeviceRow = typeof signedInDevices.$inferSelect;

@Injectable()
export class PostgresSignedInDeviceRepository extends SignedInDeviceRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(device: SignedInDevice): Promise<void> {
    await this.database.insert(signedInDevices).values(toRow(device));
  }

  async findByTokenHash(tokenHash: string): Promise<SignedInDevice | undefined> {
    const [row] = await this.database
      .select()
      .from(signedInDevices)
      .where(eq(signedInDevices.tokenHash, tokenHash));
    return row && toSignedInDevice(row);
  }

  async findAll(ids: readonly string[]): Promise<readonly SignedInDevice[]> {
    if (ids.length === 0) return [];
    const rows = await this.database
      .select()
      .from(signedInDevices)
      .where(inArray(signedInDevices.id, [...ids]));
    return rows.map(toSignedInDevice);
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

  async removeAllOf(userId: string): Promise<readonly string[]> {
    const removed = await this.database
      .delete(signedInDevices)
      .where(eq(signedInDevices.userId, userId))
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
