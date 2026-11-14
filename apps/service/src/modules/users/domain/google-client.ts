/**
 * The Google OAuth client Continue with Google signs in through (spec §2.10): one per Office,
 * registered by a user in Google Cloud Console and entered in Settings › Signing in. Its secret has
 * to be sent to Google, so it is kept as entered, and never sent to the web.
 */
export interface GoogleClient {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly savedAt: Date;
}

/** The client as Settings › Signing in enters it: an empty secret keeps the one saved. */
export interface GoogleClientEntry {
  readonly clientId: string;
  readonly clientSecret: string;
}

const MAX_LENGTH = 512;

/**
 * The client to save from what was entered over the one saved, or every problem in the page's
 * words. The client id and secret are trimmed, as they are pasted from Google Cloud Console.
 */
export function googleClientOf(
  entry: GoogleClientEntry,
  saved: GoogleClient | undefined,
  savedAt: Date,
): { readonly client: GoogleClient } | { readonly problems: readonly string[] } {
  const clientId = entry.clientId.trim();
  const clientSecret = entry.clientSecret.trim() || (saved?.clientSecret ?? "");
  const problems = [
    ...(clientId === "" ? ["Enter the client ID."] : []),
    ...(clientSecret === "" ? ["Enter the client secret."] : []),
    ...(clientId.length > MAX_LENGTH || clientSecret.length > MAX_LENGTH
      ? [`The client ID and secret are at most ${MAX_LENGTH} characters.`]
      : []),
  ];
  if (problems.length > 0) return { problems };
  return { client: { clientId, clientSecret, savedAt } };
}
