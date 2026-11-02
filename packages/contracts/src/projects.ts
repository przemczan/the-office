import { z } from "zod";
import { engineModelSchema } from "./engines.js";
import { webEventSchema } from "./events.js";

export const projectCommandKeySchema = z.enum(["install", "build", "lint", "test"]);
export type ProjectCommandKey = z.infer<typeof projectCommandKeySchema>;

/** How Publish ships a Task's branch: pushed with a pull request opened, or merged. */
export const publishingModeSchema = z.enum(["push-and-pull-request", "merge"]);
export type PublishingMode = z.infer<typeof publishingModeSchema>;

/** The design system's ramps a Project's mark may take. */
export const projectMarkColourSchema = z.enum(["teal", "violet", "gray", "ink"]);
export type ProjectMarkColour = z.infer<typeof projectMarkColourSchema>;

/** Up to three letters or digits from the name's words, as a mark's label: "Admin panel" → "AP". */
export function markLabelFor(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials =
    words.length > 1 ? words.map((word) => word[0]).join("") : (words[0]?.slice(0, 2) ?? "");
  return initials.slice(0, 3).toUpperCase();
}

const projectMarkSchema = z.object({ label: z.string(), colour: projectMarkColourSchema });

const projectCommandsSchema = z.object({
  install: z.string(),
  build: z.string(),
  lint: z.string(),
  test: z.string(),
});

/** What the user gives to add a Project (POST /projects). */
export const newProjectSchema = z.object({
  name: z.string(),
  path: z.string(),
  /**
   * Given only for a clone (POST /repositories/clones), or a Proposal of a Project to onboard by its
   * Repository URL, whose clone's folder `path` must then be.
   */
  repositoryUrl: z.string().optional(),
  baseBranch: z.string(),
  mark: projectMarkSchema,
  commands: projectCommandsSchema,
  /** Paths inside the repository whose change makes a worktree install again. */
  installInputs: z.array(z.string()),
  publishingMode: publishingModeSchema,
  /** A Pipeline's id. */
  defaultPipeline: z.string(),
});
export type NewProject = z.infer<typeof newProjectSchema>;

/** How the Project's commands and Agents change the variables they inherit. */
export const projectEnvironmentSchema = z.object({
  set: z.array(z.object({ name: z.string(), value: z.string() })),
  unset: z.array(z.string()),
  /** Folders put in front of PATH, in this order. */
  prependPath: z.array(z.string()),
});
export type ProjectEnvironment = z.infer<typeof projectEnvironmentSchema>;

/**
 * Which part of the Office identity the base branch's remote needs, and what of it is missing:
 * Sign in with GitHub for GitHub over https; the Office ssh key and a trusted host key over ssh;
 * nothing for another https host, reached anonymously, or a local remote. Another transport is
 * refused.
 */
export const remoteNeedsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("github-https"), missing: z.array(z.literal("sign-in-with-github")) }),
  z.object({
    kind: z.literal("ssh"),
    host: z.string(),
    port: z.number().int(),
    missing: z.array(z.enum(["office-ssh-key", "host-key"])),
  }),
  z.object({ kind: z.literal("anonymous-https"), host: z.string() }),
  z.object({ kind: z.literal("local") }),
  z.object({ kind: z.literal("refused"), scheme: z.string() }),
]);
export type RemoteNeeds = z.infer<typeof remoteNeedsSchema>;

/** GET /projects/:id/remote-needs, read from the repository each time; null when the base branch tracks no remote branch. */
export const projectRemoteNeedsSchema = z.object({ remoteNeeds: remoteNeedsSchema.nullable() });
export type ProjectRemoteNeeds = z.infer<typeof projectRemoteNeedsSchema>;

/** The engine and model a Role runs on in a Project, winning over every other level. */
export const projectRoleOverrideSchema = engineModelSchema.extend({ roleKey: z.string() });
export type ProjectRoleOverride = z.infer<typeof projectRoleOverrideSchema>;

export const projectSchema = newProjectSchema.extend({
  id: z.string().min(1),
  /** What the repository was cloned from; null for a Project added by its path. */
  repositoryUrl: z.string().nullable(),
  environment: projectEnvironmentSchema,
  useProjectSkills: z.boolean(),
  /** The engine cascade's Project levels (spec §5.4); null when the Project has no default. */
  projectDefault: engineModelSchema.nullable(),
  /** Only with a Project default: it wins over the Office-wide Role overrides. */
  useForEveryRole: z.boolean(),
  /** At most one per Role. */
  roleOverrides: z.array(projectRoleOverrideSchema),
  addedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListSchema = z.array(projectSchema);

/** The commands and install inputs a Proposal changes, each one whole; the rest stay. */
export const projectCommandFieldsSchema = projectCommandsSchema
  .partial()
  .extend({ installInputs: z.array(z.string()).optional() });
export type ProjectCommandFields = z.infer<typeof projectCommandFieldsSchema>;

/** PUT /projects/:id/commands/:key */
export const commandChangeSchema = z.object({ commandLine: z.string() });
export type CommandChange = z.infer<typeof commandChangeSchema>;

/** PUT /projects/:id/install-inputs */
export const installInputsChangeSchema = z.object({ installInputs: z.array(z.string()) });
export type InstallInputsChange = z.infer<typeof installInputsChangeSchema>;

/** PUT /projects/:id/publishing-mode */
export const publishingModeChangeSchema = z.object({ publishingMode: publishingModeSchema });
export type PublishingModeChange = z.infer<typeof publishingModeChangeSchema>;

/** PUT /projects/:id/default-pipeline */
export const defaultPipelineChangeSchema = z.object({ defaultPipeline: z.string() });
export type DefaultPipelineChange = z.infer<typeof defaultPipelineChangeSchema>;

/** PUT /projects/:id/use-project-skills */
export const useProjectSkillsChangeSchema = z.object({ useProjectSkills: z.boolean() });
export type UseProjectSkillsChange = z.infer<typeof useProjectSkillsChangeSchema>;

/** PUT /projects/:id/project-default; null leaves the Project without one. */
export const projectDefaultChangeSchema = z.object({
  projectDefault: engineModelSchema.nullable(),
});
export type ProjectDefaultChange = z.infer<typeof projectDefaultChangeSchema>;

/** PUT /projects/:id/use-for-every-role */
export const useForEveryRoleChangeSchema = z.object({ useForEveryRole: z.boolean() });
export type UseForEveryRoleChange = z.infer<typeof useForEveryRoleChangeSchema>;

/** PUT /projects/:id/role-overrides/:roleKey; null removes the Role's override. */
export const roleOverrideChangeSchema = z.object({ roleOverride: engineModelSchema.nullable() });
export type RoleOverrideChange = z.infer<typeof roleOverrideChangeSchema>;

/** How a Project command ended. */
export const commandOutcomeSchema = z.enum([
  "passed",
  "failed",
  "could-not-run",
  "timed-out",
  "stopped",
]);
export type CommandOutcome = z.infer<typeof commandOutcomeSchema>;

/** A Project command The Office ran, with its output cut to what tells why it failed. */
export const commandRunSchema = z.object({
  commandLine: z.string(),
  outcome: commandOutcomeSchema,
  /** Absent when it never exited by itself. */
  exitCode: z.number().int().optional(),
  durationMs: z.number().int(),
  output: z.string(),
});
export type CommandRun = z.infer<typeof commandRunSchema>;

export const checkStateSchema = z.enum(["waiting", "running", "passed", "failed", "skipped"]);
export type CheckState = z.infer<typeof checkStateSchema>;

/** That a fresh worktree of the freshly fetched base branch opens. */
export const worktreeCheckSchema = z.object({
  step: z.literal("worktree"),
  state: checkStateSchema,
  base: z
    .object({
      commit: z.string(),
      /** Such as `origin/main`; absent when the base branch tracks none and was used unfetched. */
      fetchedFrom: z.string().optional(),
    })
    .optional(),
  /** Why it failed, in git's words. */
  problem: z.string().optional(),
});
export type WorktreeCheck = z.infer<typeof worktreeCheckSchema>;

/** That one of the Project's commands passes in that worktree. */
export const commandCheckSchema = z.object({
  step: projectCommandKeySchema,
  state: checkStateSchema,
  commandLine: z.string(),
  run: commandRunSchema.optional(),
});
export type CommandCheck = z.infer<typeof commandCheckSchema>;

export const environmentCheckStateSchema = z.enum(["running", "passed", "failed", "stopped"]);
export type EnvironmentCheckState = z.infer<typeof environmentCheckStateSchema>;

/** A try of an environment in a fresh worktree; it is saved only when every check passes. */
export const environmentCheckSchema = z.object({
  projectId: z.string(),
  environment: projectEnvironmentSchema,
  state: environmentCheckStateSchema,
  /** The worktree's check, then install, build, lint and test. */
  checks: z.array(z.discriminatedUnion("step", [worktreeCheckSchema, commandCheckSchema])),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
});
export type EnvironmentCheck = z.infer<typeof environmentCheckSchema>;

/** GET /projects/:id/environment-check: the running check, or the last finished one. */
export const latestEnvironmentCheckSchema = z.object({ check: environmentCheckSchema.nullable() });
export type LatestEnvironmentCheck = z.infer<typeof latestEnvironmentCheckSchema>;

/** POST /projects/:id/environment-check */
export const environmentCheckStartSchema = z.object({ environment: projectEnvironmentSchema });
export type EnvironmentCheckStart = z.infer<typeof environmentCheckStartSchema>;

/** What a refused change answers: every reason, also joined into Nest's `message`. */
export const projectRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type ProjectRefusal = z.infer<typeof projectRefusalSchema>;

/** The Project's events the web receives; each says which Project changed, so its queries refresh. */
export const projectWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("project.added"), projectId: z.string() }),
  webEventSchema.extend({
    type: z.literal("project.command-changed"),
    projectId: z.string(),
    key: projectCommandKeySchema,
  }),
  webEventSchema.extend({
    type: z.literal("project.environment-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    /** A check started, one of its checks moved on, or it finished. */
    type: z.literal("project.environment-check-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.install-inputs-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.publishing-mode-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.default-pipeline-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.project-default-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.use-for-every-role-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.role-override-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.use-project-skills-changed"),
    projectId: z.string(),
  }),
]);
export type ProjectWebEvent = z.infer<typeof projectWebEventSchema>;

/** What the user gives to clone a repository before adding it (POST /repositories/clones). */
export const repositoryCloneStartSchema = z.object({
  /** A Repository URL: https, `ssh://` or `user@host:path`. */
  url: z.string(),
});
export type RepositoryCloneStart = z.infer<typeof repositoryCloneStartSchema>;

/** How far a clone has got, in git's words. */
export const cloneProgressSchema = z.object({
  phase: z.string(),
  percent: z.number().int().min(0).max(100).optional(),
});
export type CloneProgress = z.infer<typeof cloneProgressSchema>;

const repositoryCloneFieldsSchema = z.object({
  id: z.string().min(1),
  url: z.string(),
  /** `<office-data>/repositories/<host>/<owner>/<repo>`, the path the Project is added by. */
  path: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
});

/**
 * A repository cloned by its Repository URL (POST /repositories/clones, GET …/:id): under way with
 * its progress, cloned with the remote's default branch and branches, or failed and why.
 */
export const repositoryCloneSchema = z.discriminatedUnion("state", [
  repositoryCloneFieldsSchema.extend({
    state: z.literal("cloning"),
    progress: cloneProgressSchema.optional(),
  }),
  repositoryCloneFieldsSchema.extend({
    state: z.literal("cloned"),
    defaultBranch: z.string(),
    branches: z.array(z.string()),
  }),
  repositoryCloneFieldsSchema.extend({ state: z.literal("failed"), problem: z.string() }),
]);
export type RepositoryClone = z.infer<typeof repositoryCloneSchema>;

/** A clone started, moved on or finished; the web reads it again by its id. */
export const repositoryCloneWebEventSchema = webEventSchema.extend({
  type: z.literal("repository-clone.changed"),
  cloneId: z.string(),
});
export type RepositoryCloneWebEvent = z.infer<typeof repositoryCloneWebEventSchema>;

/** A file a Task's commits changed since its branch left the base branch. */
export const changedFileSchema = z.object({
  /** Relative to the repository, with "/" between folders: where it is now, or was if deleted. */
  path: z.string().min(1),
  /** Where it was before the Task renamed it. */
  previousPath: z.string().min(1).nullable(),
  /** Null for a binary file, whose lines git doesn't count. */
  lines: z.object({ added: z.int().nonnegative(), removed: z.int().nonnegative() }).nullable(),
  /** The Task deleted it, so the worktree no longer has it to open. */
  deleted: z.boolean(),
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

/**
 * GET /projects/:id/tasks/:taskId/changes: what the Task's commits changed since its branch left
 * the base branch, for the Changes tab; no files before the Task has a branch.
 */
export const taskChangesSchema = z.object({
  /** The Task's worktree on the workstation, to open in the editor; null while it has none. */
  worktreePath: z.string().min(1).nullable(),
  files: z.array(changedFileSchema),
  /** The unified diff, cut at a whole line when it is longer than the tab shows. */
  diff: z.string(),
  diffCut: z.boolean(),
});
export type TaskChanges = z.infer<typeof taskChangesSchema>;
