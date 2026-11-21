/** The Decisions waiting on the user, which Conversations keeps; the composition root binds it. */
export abstract class ActivityDecisions {
  abstract listOpen(): Promise<readonly { readonly taskId?: string | undefined }[]>;
}
