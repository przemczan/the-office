import { Inject, Injectable } from "@nestjs/common";
import { isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { OpenIdConnectProvider } from "../../domain/openid-connect-provider.js";
import { OpenIdConnectProviderRepository } from "../../ports/openid-connect-provider-repository.js";
import { openIdConnectProvider } from "./openid-connect-provider.schema.js";

@Injectable()
export class PostgresOpenIdConnectProviderRepository extends OpenIdConnectProviderRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async find(): Promise<OpenIdConnectProvider | undefined> {
    const [row] = await this.database
      .select()
      .from(openIdConnectProvider)
      .where(isNull(openIdConnectProvider.removedAt));
    return (
      row && {
        name: row.name,
        issuer: row.issuer,
        clientId: row.clientId,
        clientSecret: row.clientSecret,
        authorizationEndpoint: row.authorizationEndpoint,
        tokenEndpoint: row.tokenEndpoint,
        savedAt: row.savedAt,
      }
    );
  }

  async lastIssuer(): Promise<string | undefined> {
    const [row] = await this.database
      .select({ issuer: openIdConnectProvider.issuer })
      .from(openIdConnectProvider);
    return row?.issuer;
  }

  async save(provider: OpenIdConnectProvider): Promise<void> {
    const saved = { ...provider, removedAt: null };
    await this.database
      .insert(openIdConnectProvider)
      .values({ id: 1, ...saved })
      .onConflictDoUpdate({ target: openIdConnectProvider.id, set: saved });
  }

  async remove(at: Date): Promise<boolean> {
    const removed = await this.database
      .update(openIdConnectProvider)
      .set({ clientSecret: "", removedAt: at })
      .where(isNull(openIdConnectProvider.removedAt))
      .returning({ id: openIdConnectProvider.id });
    return removed.length > 0;
  }
}
