import type { GoogleClient } from "../domain/google-client.js";

/** Where the one Google OAuth client is kept, its secret as entered, as it is sent to Google. */
export abstract class GoogleClientRepository {
  abstract find(): Promise<GoogleClient | undefined>;

  /** Keeps it in place of the one saved. */
  abstract save(client: GoogleClient): Promise<void>;

  /** Forgets it; says whether there was one. */
  abstract remove(): Promise<boolean>;
}
