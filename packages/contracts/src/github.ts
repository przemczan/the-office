import { z } from "zod";
import { webEventSchema } from "./events.js";

/** Where the browser lands after registering the GitHub App or signing in: Settings › Office identity. */
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

/**
 * The query parameter that lands the browser on Settings › Office identity with why signing in
 * failed. Absent after a sign-in that worked.
 */
export const GITHUB_SIGN_IN_FAILED_PARAMETER = "signInFailed";

/** GitHub's authorize page, where the browser goes to sign in; GitHub sends it back to The Office. */
export const gitHubSignInSchema = z.object({ authorizeUrl: z.url() });
export type GitHubSignIn = z.infer<typeof gitHubSignInSchema>;

const registeredAppSchema = z.object({
  slug: z.string().min(1),
  /** The login of the account the App was registered on. */
  owner: z.string().min(1),
  /** GitHub's page that installs the App on an account's repositories. */
  installUrl: z.url(),
});

/**
 * Sign in with GitHub as Settings › Office identity shows it. Tokens are never part of it: they stay
 * in the service.
 */
export const gitHubStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not-registered") }),
  z.object({
    status: z.literal("signed-out"),
    app: registeredAppSchema,
    /** Why the user was signed out, when The Office did it rather than the user. */
    reason: z.object({ text: z.string().min(1) }).optional(),
  }),
  z.object({ status: z.literal("signed-in"), app: registeredAppSchema, login: z.string().min(1) }),
]);
export type GitHubState = z.infer<typeof gitHubStateSchema>;

/** A repository the GitHub App is installed on that the signed-in user can reach, for Add Project. */
export const gitHubRepositorySchema = z.object({
  /** `owner/name`. */
  fullName: z.string().min(1),
  /** Its https Repository URL, to clone it by. */
  repositoryUrl: z.string().min(1),
  private: z.boolean(),
  defaultBranch: z.string().min(1),
});
export type GitHubRepository = z.infer<typeof gitHubRepositorySchema>;

/** Every repository the App is installed on that the user can reach, by `fullName`. */
export const gitHubRepositoryListSchema = z.array(gitHubRepositorySchema);
export type GitHubRepositoryList = z.infer<typeof gitHubRepositoryListSchema>;

/** Sign in with GitHub changed, so an open Settings page refetches it. */
export const gitHubWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("github.changed") }),
]);
export type GitHubWebEvent = z.infer<typeof gitHubWebEventSchema>;
