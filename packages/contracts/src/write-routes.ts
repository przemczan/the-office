export type WriteRouteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

/** A write route as its controller declares it, without `/api`: `"POST /tasks/:id/start"`. */
export type WriteRoute = `${WriteRouteMethod} /${string}`;

export interface UsersAloneRoute {
  readonly route: WriteRoute;
  /** The spec heading that says why, relative to `docs/spec/`: `"6-permissions-and-safety.md#secrets"`. */
  readonly specHeading: string;
}

export interface NoActionRoute {
  readonly route: WriteRoute;
  /** Why no Agent needs it, in one line. */
  readonly reason: string;
}

export interface KnownGapRoute {
  readonly route: WriteRoute;
  /**
   * The agent-parity analysis's mark for it: an Office tool does it by hand (`tool`), drafts it
   * (`proposal`), covers some of it (`partial`) or nothing does (`gap`). Every one is a tool
   * wanted: a route the user's alone or needing no action belongs in its own list instead.
   */
  readonly agent: "tool" | "proposal" | "partial" | "gap";
  readonly note?: string;
}

export interface WriteRouteRegister {
  readonly usersAlone: readonly UsersAloneRoute[];
  readonly noAction: readonly NoActionRoute[];
  readonly knownGaps: readonly KnownGapRoute[];
}

const THE_USERS_ALONE = "6-permissions-and-safety.md#the-users-alone";

const USERS_ALONE: readonly UsersAloneRoute[] = [
  // Work: Tasks.
  {
    route: "POST /tasks/:id/branch-deletion",
    specHeading: THE_USERS_ALONE,
  },
  {
    route: "POST /initiatives/:id/projects/:projectId/branch-deletion",
    specHeading: THE_USERS_ALONE,
  },

  // Decisions, Proposals, Threads.
  { route: "POST /proposals/:id/apply", specHeading: THE_USERS_ALONE },
  { route: "POST /proposals/:id/decline", specHeading: THE_USERS_ALONE },
  { route: "PUT /threads/:id/allow-changes", specHeading: THE_USERS_ALONE },
  { route: "DELETE /threads/:id/allow-changes", specHeading: THE_USERS_ALONE },
  { route: "POST /threads/:id/stop", specHeading: THE_USERS_ALONE },
  { route: "POST /chats/:roleKey/threads/delete", specHeading: THE_USERS_ALONE },

  // The fire alarm: an Agent may sound it, only the user eases it.
  { route: "POST /fire-alarm/all-clear", specHeading: THE_USERS_ALONE },
  { route: "PUT /fire-alarm/lifts/:threadId", specHeading: THE_USERS_ALONE },
  { route: "DELETE /fire-alarm/lifts/:threadId", specHeading: THE_USERS_ALONE },

  // Projects: running an Action, merging a pull request.
  {
    route: "POST /projects/:id/actions/:key/runs",
    specHeading: THE_USERS_ALONE,
  },
  { route: "POST /action-runs/:id/stop", specHeading: THE_USERS_ALONE },
  { route: "POST /pull-requests/:id/merge", specHeading: THE_USERS_ALONE },

  // Connected devices: the browser's device picker, or a pairing code typed from the phone.
  { route: "POST /tasks/:taskId/devices", specHeading: THE_USERS_ALONE },
  { route: "POST /tasks/:taskId/devices/wireless", specHeading: THE_USERS_ALONE },
  { route: "POST /projects/:projectId/devices", specHeading: THE_USERS_ALONE },
  { route: "POST /project-devices/:id/pair", specHeading: THE_USERS_ALONE },

  // Credentials: they sign The Office in somewhere, or decide whom it trusts.
  { route: "POST /settings/engines/:engineId/sign-in", specHeading: THE_USERS_ALONE },
  { route: "POST /settings/engines/:engineId/sign-in/code", specHeading: THE_USERS_ALONE },
  { route: "DELETE /settings/engines/:engineId/sign-in", specHeading: THE_USERS_ALONE },
  { route: "PUT /settings/engines/:engineId/token", specHeading: THE_USERS_ALONE },
  { route: "PUT /settings/engines/:engineId/api-key", specHeading: THE_USERS_ALONE },
  { route: "POST /github/sign-in", specHeading: THE_USERS_ALONE },
  { route: "DELETE /github/sign-in", specHeading: THE_USERS_ALONE },
  { route: "PUT /settings/google-client", specHeading: THE_USERS_ALONE },
  { route: "DELETE /settings/google-client", specHeading: THE_USERS_ALONE },
  { route: "PUT /settings/openid-connect-provider", specHeading: THE_USERS_ALONE },
  { route: "DELETE /settings/openid-connect-provider", specHeading: THE_USERS_ALONE },
  { route: "POST /office-identity/ssh-key/regenerate", specHeading: THE_USERS_ALONE },
  { route: "POST /office-identity/known-hosts/scan", specHeading: THE_USERS_ALONE },
  { route: "POST /office-identity/known-hosts", specHeading: THE_USERS_ALONE },

  // Signing in and out, in every way: a person is never a user.
  { route: "POST /sign-in/first-user", specHeading: THE_USERS_ALONE },
  { route: "POST /sign-in/password", specHeading: THE_USERS_ALONE },
  { route: "POST /sign-in/set-password", specHeading: THE_USERS_ALONE },
  { route: "POST /sign-in/code", specHeading: THE_USERS_ALONE },
  { route: "POST /sign-in/github", specHeading: THE_USERS_ALONE },
  { route: "POST /sign-in/google", specHeading: THE_USERS_ALONE },
  { route: "POST /sign-in/openid-connect", specHeading: THE_USERS_ALONE },
  { route: "POST /sign-in/passkey", specHeading: THE_USERS_ALONE },
  { route: "POST /sign-out", specHeading: THE_USERS_ALONE },

  // Users and First-run setup: signing in guards The Office against people without an account.
  { route: "POST /users", specHeading: THE_USERS_ALONE },
  { route: "POST /users/:userId/one-time-password", specHeading: THE_USERS_ALONE },
  { route: "DELETE /users/:userId", specHeading: THE_USERS_ALONE },
  { route: "POST /first-run-setup/close", specHeading: THE_USERS_ALONE },

  // The user's own account, notification settings among it: each user's own.
  { route: "PATCH /account", specHeading: THE_USERS_ALONE },
  { route: "POST /account/password", specHeading: THE_USERS_ALONE },
  { route: "PUT /account/appearance", specHeading: THE_USERS_ALONE },
  { route: "POST /account/authenticator", specHeading: THE_USERS_ALONE },
  { route: "POST /account/authenticator/confirm", specHeading: THE_USERS_ALONE },
  { route: "DELETE /account/authenticator", specHeading: THE_USERS_ALONE },
  { route: "POST /account/recovery-codes", specHeading: THE_USERS_ALONE },
  { route: "POST /account/passkeys", specHeading: THE_USERS_ALONE },
  { route: "PATCH /account/passkeys/:id", specHeading: THE_USERS_ALONE },
  { route: "DELETE /account/passkeys/:id", specHeading: THE_USERS_ALONE },
  { route: "POST /account/linked-identities/github", specHeading: THE_USERS_ALONE },
  { route: "POST /account/linked-identities/google", specHeading: THE_USERS_ALONE },
  { route: "POST /account/linked-identities/openid-connect", specHeading: THE_USERS_ALONE },
  { route: "DELETE /account/linked-identities/github", specHeading: THE_USERS_ALONE },
  { route: "DELETE /account/linked-identities/google", specHeading: THE_USERS_ALONE },
  { route: "DELETE /account/linked-identities/openid-connect", specHeading: THE_USERS_ALONE },
  { route: "DELETE /account/signed-in-devices/:id", specHeading: THE_USERS_ALONE },
  { route: "PUT /account/notifications/timing", specHeading: THE_USERS_ALONE },
  { route: "PUT /account/notifications/routing/:level", specHeading: THE_USERS_ALONE },
  { route: "DELETE /account/notifications/routing/:level", specHeading: THE_USERS_ALONE },
];

const NO_ACTION: readonly NoActionRoute[] = [
  // Checks: they change nothing, and the actions' tools check first.
  { route: "POST /tasks/:id/stages/check", reason: "Checks edited Stages; changes nothing." },
  { route: "POST /pipelines/check", reason: "Checks a Pipeline; changes nothing." },
  { route: "POST /project-pipelines/check", reason: "Checks a Project Pipeline; changes nothing." },
  { route: "POST /stage-templates/check", reason: "Checks a Stage template; changes nothing." },
  {
    route: "POST /settings/prompt-templates/:key/check",
    reason: "Checks a Prompt template; changes nothing.",
  },
  {
    route: "POST /mcp-servers/pasted-config",
    reason: "Reads a pasted MCP config into the add form; changes nothing.",
  },

  // The browser's own: "seen", activity, refreshes and uploaded bytes.
  { route: "PUT /threads/:id/seen", reason: "Marks what the signed-in user has seen." },
  { route: "POST /activity", reason: "Reports the signed-in user as active." },
  {
    route: "POST /pull-requests/refresh",
    reason: "Refreshes the pull requests from the code host.",
  },
  { route: "POST /ci-runs/refresh", reason: "Refreshes the CI runs from the code host." },
  {
    route: "POST /threads/:id/images",
    reason: "Keeps a pasted image's bytes for the message the user sends.",
  },
  {
    route: "POST /skills/uploads",
    reason: "A skill's uploaded bytes; install_skill installs from a source.",
  },
  {
    route: "POST /skills/:name/versions",
    reason: "An uploaded skill's next version, as bytes; edit_skill saves a written skill's.",
  },
  { route: "POST /roles/:key/avatar", reason: "An uploaded Avatar's bytes." },
  {
    route: "POST /projects/:id/images/:image/:palette",
    reason: "An uploaded Icon's or Logo's bytes.",
  },
  {
    route: "POST /projects/:id/test-targets/chat",
    reason: "Opens the onboarding holder's chat, which drafts with change_project_settings.",
  },

  // Written by hand, one tool for the call: the route is the user's, the tool the person's.
  {
    route: "POST /tasks/:id/attachments/files",
    reason: "The user's upload from their device, multipart; Agents use attach_file.",
  },
  {
    route: "POST /projects/:id/commands",
    reason:
      "One section of change_project_settings, one held call through the route's own Projects method.",
  },
  {
    route: "PUT /projects/:id/commands/:key",
    reason:
      "One section of change_project_settings, one held call through the route's own Projects method.",
  },
  {
    route: "DELETE /projects/:id/commands/:key",
    reason:
      "One section of change_project_settings, one held call through the route's own Projects method.",
  },
  {
    route: "PUT /projects/:id/install-command",
    reason:
      "One section of change_project_settings, one held call through the route's own Projects method.",
  },
  {
    route: "PUT /projects/:id/install-inputs",
    reason:
      "One section of change_project_settings, one held call through the route's own Projects method.",
  },
  {
    route: "PUT /projects/:id/environment",
    reason:
      "One section of change_project_settings, one held call through the route's own Projects method.",
  },
  {
    route: "PUT /projects/:id/test-targets",
    reason:
      "One section of change_project_settings, one held call through the route's own Projects method.",
  },
  {
    route: "PUT /projects/:id/actions",
    reason:
      "One section of change_project_settings, one held call through the route's own Projects method.",
  },
  {
    route: "PUT /projects/:id/run-environment",
    reason:
      "One section of change_project_settings, one held call through the route's own Projects method.",
  },

  // Sign-in plumbing and the session's hook.
  {
    route: "POST /sign-in/passkey/options",
    reason: "The browser's passkey challenge for signing in.",
  },
  {
    route: "POST /account/passkeys/options",
    reason: "The browser's passkey challenge for adding one.",
  },
  {
    route: "POST /engine/claude-code-p/hook",
    reason: "Called by a -p session's hook, not by a user.",
  },
];

const KNOWN_GAPS: readonly KnownGapRoute[] = [
  // Work: Tasks.
  { route: "POST /tasks", agent: "tool", note: "create_task (hand-written)" },
  { route: "PUT /tasks/:id/tags", agent: "partial", note: "write_tags, planning Threads only" },
  {
    route: "PUT /tasks/:id/caused-by",
    agent: "partial",
    note: "write_bug_details, planning Threads only",
  },
  {
    route: "PUT /tasks/:id/found-in-version",
    agent: "partial",
    note: "write_bug_details, planning Threads only",
  },

  // Work: Ideas, Initiatives, Attachments, views.
  { route: "POST /ideas", agent: "tool", note: "capture_idea (hand-written)" },
  {
    route: "PUT /initiatives/:id/pipelines",
    agent: "partial",
    note: "choose_pipeline, one Project at a time",
  },
  { route: "POST /initiatives/:id/shaping", agent: "gap" },
  { route: "POST /initiatives/:id/planning", agent: "gap" },
  { route: "POST /initiatives/:id/plan-with", agent: "gap" },
  { route: "POST /ideas/:id/attachments/links", agent: "gap" },
  { route: "POST /ideas/:id/attachments/files", agent: "gap" },
  { route: "POST /initiatives/:id/attachments/links", agent: "gap" },
  { route: "POST /initiatives/:id/attachments/files", agent: "gap" },
  { route: "DELETE /attachments/:id", agent: "gap" },

  // Decisions, Proposals, Threads.
  {
    route: "POST /decisions/:id/answer",
    agent: "partial",
    note: "answer_decision; an approval and the Bug Task's creation stay the user's (2.4.2)",
  },
  { route: "POST /chats/:roleKey/threads", agent: "partial", note: "consult, post_link_card" },
  {
    route: "POST /tasks/:taskId/conversation/:roleKey/thread",
    agent: "partial",
    note: "consult, post_link_card",
  },
  { route: "POST /threads/:id/messages", agent: "partial", note: "consult" },
  { route: "PUT /threads/:id/title", agent: "gap" },
  { route: "PUT /threads/:id/context-override", agent: "gap" },

  // Projects and their settings.
  { route: "POST /projects", agent: "proposal", note: "propose_project" },
  { route: "POST /repositories/clones", agent: "proposal", note: "propose_project" },
  {
    route: "POST /projects/:id/environment-check",
    agent: "tool",
    note: "run_environment_check (hand-written)",
  },

  // People and Role cards.
  {
    route: "POST /roles/:key/memory",
    agent: "tool",
    note: "remember (hand-written), one's own Memory only",
  },
  { route: "DELETE /roles/:key/memory", agent: "gap" },

  // Test instances, Connected devices.
  {
    route: "POST /devices/:id/disconnect",
    agent: "gap",
    note: "wanted: an Agent gives back a device it lent, as any user disconnects one (2.13)",
  },
  { route: "PATCH /project-devices/:id", agent: "gap" },
  { route: "DELETE /project-devices/:id", agent: "gap" },
];

/**
 * Every write route the service serves that isn't an Office action (spec 5.4.1, "Office actions"),
 * seeded from the agent-parity analysis's table and grouped by its sections: the user's alone, with
 * the spec heading that says why; needing no action, with a one-line reason; or a known gap.
 * `knownGaps` only shrinks: a route leaves it when it becomes an Office action or gets a written
 * reason, and `write-routes.test.ts` fails when it holds more than its tracked count.
 * `app.module.test.ts` fails for a route in none of these, and for an entry whose route is gone.
 */
export const WRITE_ROUTE_REGISTER: WriteRouteRegister = {
  usersAlone: USERS_ALONE,
  noAction: NO_ACTION,
  knownGaps: KNOWN_GAPS,
};
