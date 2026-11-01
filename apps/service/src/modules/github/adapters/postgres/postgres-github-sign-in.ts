import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { KeptSignIn } from "../../domain/sign-in.js";
import { GitHubSignInRepository } from "../../ports/github-sign-in-repository.js";
import { githubSignIn } from "./github.schema.js";

type SignInRow = typeof githubSignIn.$inferInsert;

@Injectable()
export class PostgresGitHubSignIn extends GitHubSignInRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<KeptSignIn | undefined> {
    const [row] = await this.database.select().from(githubSignIn).limit(1);
    if (row === undefined) return undefined;
    if (row.login !== null && row.accessToken !== null) {
      return {
        status: "signed-in",
        login: row.login,
        tokens: {
          accessToken: row.accessToken,
          accessTokenExpiresAt: row.accessTokenExpiresAt ?? undefined,
          refreshToken: row.refreshToken ?? undefined,
          refreshTokenExpiresAt: row.refreshTokenExpiresAt ?? undefined,
        },
      };
    }
    // The table's check keeps a reason on every row without a token.
    return { status: "signed-out", reason: { text: row.signedOutReason ?? "" } };
  }

  async replace(signIn: KeptSignIn | undefined): Promise<void> {
    if (signIn === undefined) {
      await this.database.delete(githubSignIn);
      return;
    }
    const row = rowOf(signIn);
    await this.database
      .insert(githubSignIn)
      .values(row)
      .onConflictDoUpdate({ target: githubSignIn.id, set: row });
  }
}

/** Every column, so replacing one kind of row with the other leaves nothing of the first behind. */
function rowOf(signIn: KeptSignIn): Required<Omit<SignInRow, "id">> {
  if (signIn.status === "signed-in") {
    const { tokens } = signIn;
    return {
      login: signIn.login,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt ?? null,
      refreshToken: tokens.refreshToken ?? null,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt ?? null,
      signedOutReason: null,
    };
  }
  return {
    login: null,
    accessToken: null,
    accessTokenExpiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    signedOutReason: signIn.reason.text,
  };
}
