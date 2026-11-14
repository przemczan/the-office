import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GoogleClientRepository } from "../../ports/google-client-repository.js";
import { startUsersApplication, type UsersApplication } from "../../users-application.fixtures.js";

const NOW = new Date("2026-11-14T09:00:00.000Z");

// The only test that writes `google_client`, one row every test file's app would read.
let office: UsersApplication;
let repository: GoogleClientRepository;

beforeEach(async () => {
  office = await startUsersApplication();
  repository = office.app.get(GoogleClientRepository, { strict: false });
  await repository.remove();
});

afterEach(async () => {
  await repository.remove();
  await office.app.close();
});

describe("PostgresGoogleClientRepository", () => {
  it("keeps one client, replaced by the next saved, and forgets it", async () => {
    expect(await repository.find()).toBeUndefined();

    await repository.save({ clientId: "first", clientSecret: "first-secret", savedAt: NOW });
    const later = new Date(NOW.getTime() + 1000);
    await repository.save({ clientId: "second", clientSecret: "second-secret", savedAt: later });

    expect(await repository.find()).toEqual({
      clientId: "second",
      clientSecret: "second-secret",
      savedAt: later,
    });
    expect(await repository.remove()).toBe(true);
    expect(await repository.find()).toBeUndefined();
    expect(await repository.remove()).toBe(false);
  });
});
