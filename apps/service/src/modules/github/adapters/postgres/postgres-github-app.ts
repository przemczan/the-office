import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { GitHubApp } from "../../domain/github-app.js";
import { GitHubAppRepository } from "../../ports/github-app-repository.js";
import { githubApp } from "./github.schema.js";

@Injectable()
export class PostgresGitHubApp extends GitHubAppRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<GitHubApp | undefined> {
    const [row] = await this.database.select().from(githubApp).limit(1);
    if (row === undefined) return undefined;
    const { clientId, clientSecret, slug, owner } = row;
    return { clientId, clientSecret, slug, owner };
  }

  async replace({ clientId, clientSecret, slug, owner }: GitHubApp): Promise<void> {
    const row = { clientId, clientSecret, slug, owner };
    await this.database
      .insert(githubApp)
      .values(row)
      .onConflictDoUpdate({ target: githubApp.id, set: row });
  }
}
