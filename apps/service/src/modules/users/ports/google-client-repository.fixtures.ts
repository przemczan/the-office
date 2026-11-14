import type { GoogleClient } from "../domain/google-client.js";
import { GoogleClientRepository } from "./google-client-repository.js";

/**
 * The Google OAuth client kept in memory: `google_client` is one row of the database every test
 * file shares, so only `postgres-google-client-repository.test.ts` writes it.
 */
export class InMemoryGoogleClientRepository extends GoogleClientRepository {
  constructor(public client: GoogleClient | undefined = undefined) {
    super();
  }

  find(): Promise<GoogleClient | undefined> {
    return Promise.resolve(this.client);
  }

  save(client: GoogleClient): Promise<void> {
    this.client = client;
    return Promise.resolve();
  }

  remove(): Promise<boolean> {
    const had = this.client !== undefined;
    this.client = undefined;
    return Promise.resolve(had);
  }
}

/** Binds the Google OAuth client to one in memory, saved as given or not yet. */
export function googleClientForTests(client?: GoogleClient): {
  provide: typeof GoogleClientRepository;
  useValue: InMemoryGoogleClientRepository;
} {
  return { provide: GoogleClientRepository, useValue: new InMemoryGoogleClientRepository(client) };
}
