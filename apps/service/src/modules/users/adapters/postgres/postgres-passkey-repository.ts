import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Passkey } from "../../domain/passkey.js";
import { PasskeyRepository } from "../../ports/passkey-repository.js";
import { passkeys } from "./passkeys.schema.js";

type PasskeyRow = typeof passkeys.$inferSelect;

@Injectable()
export class PostgresPasskeyRepository extends PasskeyRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(passkey: Passkey): Promise<void> {
    await this.database.insert(passkeys).values(toRow(passkey));
  }

  async find(userId: string, id: string): Promise<Passkey | undefined> {
    const [row] = await this.database
      .select()
      .from(passkeys)
      .where(and(eq(passkeys.userId, userId), eq(passkeys.id, id)));
    return row && toPasskey(row);
  }

  async findByCredentialId(credentialId: string): Promise<Passkey | undefined> {
    const [row] = await this.database
      .select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, credentialId));
    return row && toPasskey(row);
  }

  async listOf(userId: string): Promise<readonly Passkey[]> {
    const rows = await this.database
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .orderBy(asc(passkeys.createdAt), asc(passkeys.id));
    return rows.map(toPasskey);
  }

  async save({ id, name, counter, lastUsedAt }: Passkey): Promise<void> {
    await this.database
      .update(passkeys)
      .set({ name, counter, lastUsedAt: lastUsedAt ?? null })
      .where(eq(passkeys.id, id));
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const removed = await this.database
      .delete(passkeys)
      .where(and(eq(passkeys.userId, userId), eq(passkeys.id, id)))
      .returning({ id: passkeys.id });
    return removed.length > 0;
  }

  async removeAllOf(userId: string): Promise<void> {
    await this.database.delete(passkeys).where(eq(passkeys.userId, userId));
  }
}

function toRow(passkey: Passkey): PasskeyRow {
  return {
    ...passkey,
    transports: [...passkey.transports],
    lastUsedAt: passkey.lastUsedAt ?? null,
  };
}

function toPasskey(row: PasskeyRow): Passkey {
  return { ...row, lastUsedAt: row.lastUsedAt ?? undefined };
}
