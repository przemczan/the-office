import { Inject, Injectable } from "@nestjs/common";
import { eq, lte } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { PendingSignIn } from "../../domain/pending-sign-in.js";
import { PendingSignInRepository } from "../../ports/pending-sign-in-repository.js";
import { pendingSignIns } from "./users.schema.js";

@Injectable()
export class PostgresPendingSignInRepository extends PendingSignInRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add(pendingSignIn: PendingSignIn): Promise<void> {
    await this.database.insert(pendingSignIns).values(pendingSignIn);
  }

  async findByTokenHash(tokenHash: string): Promise<PendingSignIn | undefined> {
    const [row] = await this.database
      .select()
      .from(pendingSignIns)
      .where(eq(pendingSignIns.tokenHash, tokenHash));
    return row;
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.database
      .delete(pendingSignIns)
      .where(eq(pendingSignIns.id, id))
      .returning({ id: pendingSignIns.id });
    return removed.length > 0;
  }

  async removeAllOf(userId: string): Promise<void> {
    await this.database.delete(pendingSignIns).where(eq(pendingSignIns.userId, userId));
  }

  async removeExpired(now: Date): Promise<void> {
    await this.database.delete(pendingSignIns).where(lte(pendingSignIns.expiresAt, now));
  }
}
