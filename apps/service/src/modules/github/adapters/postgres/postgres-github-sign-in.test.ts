import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { KeptSignIn } from "../../domain/sign-in.js";
import { PostgresGitHubSignIn } from "./postgres-github-sign-in.js";

let app: INestApplication;
let signIns: PostgresGitHubSignIn;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, providers: [PostgresGitHubSignIn] }));
  signIns = app.get(PostgresGitHubSignIn);
});

afterAll(async () => {
  await app.close();
});

const signedIn: KeptSignIn = {
  status: "signed-in",
  login: "przemczan",
  tokens: {
    accessToken: "ghu_kept",
    accessTokenExpiresAt: new Date("2026-11-01T20:00:00.000Z"),
    refreshToken: "ghr_kept",
    refreshTokenExpiresAt: new Date("2027-05-01T12:00:00.000Z"),
  },
};

describe("PostgresGitHubSignIn", () => {
  // Every test file shares the database, so the sign-in kept before is put back.
  it("keeps one sign-in or why the user was signed out, a later one replacing it", async () => {
    const before = await signIns.read();
    try {
      await signIns.replace(signedIn);
      expect(await signIns.read()).toEqual(signedIn);

      const signedOut: KeptSignIn = {
        status: "signed-out",
        reason: { text: "The GitHub App was registered again." },
      };
      await signIns.replace(signedOut);
      expect(await signIns.read()).toEqual(signedOut);

      const neverExpiring: KeptSignIn = {
        status: "signed-in",
        login: "notnullsoft",
        tokens: {
          accessToken: "ghu_forever",
          accessTokenExpiresAt: undefined,
          refreshToken: undefined,
          refreshTokenExpiresAt: undefined,
        },
      };
      await signIns.replace(neverExpiring);
      expect(await signIns.read()).toEqual(neverExpiring);

      await signIns.replace(undefined);
      expect(await signIns.read()).toBeUndefined();
    } finally {
      await signIns.replace(before);
    }
  });
});
