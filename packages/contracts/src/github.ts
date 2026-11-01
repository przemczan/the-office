import { z } from "zod";
import { webEventSchema } from "./events.js";

/** Where the browser lands after registering the GitHub App: Settings › Office identity. */
export const OFFICE_IDENTITY_SETTINGS_PATH = "/settings/office-identity";

/**
 * The query parameter that lands the browser on Settings › Office identity with why registering
 * the GitHub App failed. Absent after a registration that worked.
 */
export const GITHUB_APP_REGISTRATION_FAILED_PARAMETER = "registrationFailed";

/**
 * The form the browser posts to GitHub to register the GitHub App by its manifest: `manifest` is
 * the JSON string GitHub reads from the form's `manifest` field.
 */
export const gitHubAppManifestFormSchema = z.object({
  action: z.url(),
  manifest: z.string().min(1),
});
export type GitHubAppManifestForm = z.infer<typeof gitHubAppManifestFormSchema>;

/** Sign in with GitHub changed, so an open Settings page refetches it. */
export const gitHubWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("github.changed") }),
]);
export type GitHubWebEvent = z.infer<typeof gitHubWebEventSchema>;
