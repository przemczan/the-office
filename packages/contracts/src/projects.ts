import { z } from "zod";
import { engineIdSchema, officeDefaultSchema } from "./engines.js";
import { webEventSchema } from "./events.js";
import { imageSchema } from "./images.js";
import { engineTypeSettingSchema, personEngineSettingsSchema } from "./people.js";
import { userRefSchema } from "./users.js";
import { OFFICE_WIDE_LIMIT_MAX, taskCreatorSchema, taskKindSchema } from "./work.js";

/** What a Project command does; a test command also gets the test handling (spec §5.5). */
export const projectCommandKindSchema = z.enum(["build", "lint", "test"]);
export type ProjectCommandKind = z.infer<typeof projectCommandKindSchema>;

/** What a command's key names: all of it but the key, which is fixed once the command is added. */
export const projectCommandFieldsSchema = z.object({
  name: z.string(),
  kind: projectCommandKindSchema,
  /** A command line for the platform's shell; blank only for a starting command not set yet. */
  commandLine: z.string(),
  /**
   * A test command's re-run command, run once in its place when it fails (spec §5.5); blank for
   * none. Missing reads as blank, as in a Proposal drafted before it existed.
   */
  rerunCommandLine: z.string().default(""),
});
export type ProjectCommandFields = z.infer<typeof projectCommandFieldsSchema>;

/** Keys a command can't take: install's, and `publish`, as publishing is the Publish Stage's. */
const RESERVED_PROJECT_COMMAND_KEYS: readonly string[] = ["install", "publish"];

/**
 * A key a Project command may take, wherever something names one: lower-case letters, digits and
 * `-`, starting with a letter, at most 40 characters, and neither install's nor Publish's. Its
 * messages are the service's own words for each rule (`commandKeyProblems`).
 */
export const projectCommandKeySchema = z
  .string()
  .max(40, "A command's key may be at most 40 characters.")
  .regex(
    /^[a-z][a-z0-9-]*$/,
    `A command's key is lower-case letters, digits and "-", starting with a letter.`,
  )
  .refine((key) => !RESERVED_PROJECT_COMMAND_KEYS.includes(key), {
    error: (issue) => `The key "${String(issue.input)}" is kept for The Office's own use.`,
  });

/**
 * One of the Project's commands besides install (POST /projects/:id/commands). The key, unique in
 * the Project, is what Stages and Agents run it by.
 */
export const projectCommandSchema = projectCommandFieldsSchema.extend({ key: z.string() });
export type ProjectCommand = z.infer<typeof projectCommandSchema>;

/** How Publish ships a Task's branch: pushed with a pull request opened, or merged. */
export const publishingModeSchema = z.enum(["push-and-pull-request", "merge"]);
export type PublishingMode = z.infer<typeof publishingModeSchema>;

/**
 * Whether the Project's checks run in its run environment: "not-decided" until the user picks On or
 * Off, and run on the host meanwhile.
 */
export const runEnvironmentSettingSchema = z.enum(["not-decided", "on", "off"]);
export type RunEnvironmentSetting = z.infer<typeof runEnvironmentSettingSchema>;

/** The design system's ramps offered as a Project mark's quick choices. */
export const namedMarkColourSchema = z.enum(["teal", "violet", "gray", "ink"]);
export type NamedMarkColour = z.infer<typeof namedMarkColourSchema>;

/** Any other colour, as `#rrggbb` in lower case so each colour has one spelling. */
const customMarkColourSchema = z.templateLiteral(["#", z.string().regex(/^[0-9a-f]{6}$/)]);
export type CustomMarkColour = z.infer<typeof customMarkColourSchema>;

export const projectMarkColourSchema = z.union([namedMarkColourSchema, customMarkColourSchema]);
export type ProjectMarkColour = z.infer<typeof projectMarkColourSchema>;

export function isCustomMarkColour(colour: ProjectMarkColour): colour is CustomMarkColour {
  return customMarkColourSchema.safeParse(colour).success;
}

/** Up to three letters or digits from the name's words, as a mark's label: "Admin panel" → "AP". */
export function markLabelFor(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials =
    words.length > 1 ? words.map((word) => word[0]).join("") : (words[0]?.slice(0, 2) ?? "");
  return initials.slice(0, 3).toUpperCase();
}

const projectMarkSchema = z.object({ label: z.string(), colour: projectMarkColourSchema });
export type Mark = z.infer<typeof projectMarkSchema>;

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
  /** Run before a Stage when the install inputs changed; blank while not set. */
  installCommand: z.string(),
  /** In the order they were added; a Project starts with build, lint and test. */
  commands: z.array(projectCommandSchema),
  /** Paths inside the repository whose change makes a worktree install again. */
  installInputs: z.array(z.string()),
  publishingMode: publishingModeSchema,
  /** A Pipeline's id. */
  defaultPipeline: z.string(),
});
export type NewProject = z.infer<typeof newProjectSchema>;

/**
 * The answer to "Run this Project's checks in a run environment?", asked once while the setting is
 * "not-decided": "yes" acts as Set up run environment, "no" sets Off, "decide-later" leaves it.
 */
export const runEnvironmentAnswerSchema = z.enum(["yes", "no", "decide-later"]);
export type RunEnvironmentAnswer = z.infer<typeof runEnvironmentAnswerSchema>;

/** The Add a Project window's request (POST /projects): the Project and the window's answers. */
export const addProjectSchema = newProjectSchema.extend({
  /** Left out, "decide-later". */
  runEnvironmentAnswer: runEnvironmentAnswerSchema.optional(),
});
export type AddProject = z.infer<typeof addProjectSchema>;

/** A plain variable, shown and saved with its value. */
const plainVariableSchema = z.object({
  name: z.string(),
  secret: z.literal(false),
  value: z.string(),
});

/**
 * How the Project's commands and Agents change the variables they inherit. A Secret variable's
 * value is never sent back once saved, only whether one is set.
 */
export const projectEnvironmentSchema = z.object({
  set: z.array(
    z.discriminatedUnion("secret", [
      plainVariableSchema,
      z.object({ name: z.string(), secret: z.literal(true), valueSet: z.boolean() }),
    ]),
  ),
  unset: z.array(z.string()),
  /** Folders put in front of PATH, in this order. */
  prependPath: z.array(z.string()),
});
export type ProjectEnvironment = z.infer<typeof projectEnvironmentSchema>;
export type ProjectVariable = ProjectEnvironment["set"][number];

/**
 * An environment as the Project page saves it: a Secret variable without a `value`, or with an
 * empty one, keeps the value the Project has under its name.
 */
export const projectEnvironmentEditSchema = z.object({
  set: z.array(
    z.discriminatedUnion("secret", [
      plainVariableSchema,
      z.object({ name: z.string(), secret: z.literal(true), value: z.string().optional() }),
    ]),
  ),
  unset: z.array(z.string()),
  prependPath: z.array(z.string()),
});
export type ProjectEnvironmentEdit = z.infer<typeof projectEnvironmentEditSchema>;

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

/** POST /projects/:id/base-branch/fetch: the commit to read folders from; `fetchProblem` says why it is only the last one known here. */
export const baseBranchFetchSchema = z.object({
  commit: z.string(),
  fetchProblem: z.string().nullable(),
});
export type BaseBranchFetch = z.infer<typeof baseBranchFetchSchema>;

/** GET /projects/:id/commits/:commit/folder: `path` "" for the top level, `extensions` joined by commas. */
export const repositoryFolderQuerySchema = z.object({
  path: z.string().default(""),
  extensions: z
    .string()
    .default("")
    .transform((extensions) => extensions.split(",").filter((extension) => extension !== "")),
});
export type RepositoryFolderQuery = z.infer<typeof repositoryFolderQuerySchema>;

export const repositoryFolderEntrySchema = z.object({
  name: z.string(),
  kind: z.enum(["file", "folder"]),
});
export type RepositoryFolderEntry = z.infer<typeof repositoryFolderEntrySchema>;

/** One folder of a commit: folders, then files, cut to a limit; `total` counts what the cut left out too. */
export const repositoryFolderSchema = z.object({
  commit: z.string(),
  path: z.string(),
  entries: z.array(repositoryFolderEntrySchema),
  total: z.number().int().nonnegative(),
});
export type RepositoryFolder = z.infer<typeof repositoryFolderSchema>;

/**
 * GET /projects/:id/branches: `fetch` "1" fetches the base branch's remote first; without it only
 * what is known here is read, as a page asking whether a branch exists does.
 */
export const projectBranchesQuerySchema = z.object({
  fetch: z
    .enum(["0", "1"])
    .default("0")
    .transform((fetch) => fetch === "1"),
});
export type ProjectBranchesQuery = z.infer<typeof projectBranchesQuerySchema>;

/**
 * A branch whose files can be browsed, at its tip. `name` is a local branch's own name or a remote
 * one's with its remote first (`origin/main`), as git shows them; the base branch is a local one.
 */
export const projectBranchSchema = z.object({
  name: z.string(),
  kind: z.enum(["local", "remote"]),
  commit: z.string(),
});
export type ProjectBranch = z.infer<typeof projectBranchSchema>;

/**
 * The branches to browse: the base branch, at its freshest commit known here (the fetched
 * upstream's, else the local branch's), and in `branches` the other local branches, then the base
 * branch's remote's (its own included), each by name. `fetchProblem` says why the remote couldn't
 * be fetched, so these are the last known commits.
 */
export const projectBranchesSchema = z.object({
  baseBranch: projectBranchSchema,
  branches: z.array(projectBranchSchema),
  fetchProblem: z.string().nullable(),
});
export type ProjectBranches = z.infer<typeof projectBranchesSchema>;

/**
 * GET /projects/:id/commits/:commit/file: the file's bytes, `download` "1" answering them as an
 * attachment with the file's name; GET …/file-preview takes `path` alone.
 */
export const repositoryFileQuerySchema = z.object({
  path: z.string().min(1),
  download: z
    .enum(["0", "1"])
    .default("0")
    .transform((download) => download === "1"),
});
export type RepositoryFileQuery = z.infer<typeof repositoryFileQuerySchema>;

export const repositoryFilePreviewQuerySchema = z.object({ path: z.string().min(1) });
export type RepositoryFilePreviewQuery = z.infer<typeof repositoryFilePreviewQuerySchema>;

/** The most bytes a file may hold to be previewed; a bigger one is only downloaded. */
export const FILE_PREVIEW_BYTES = 1024 * 1024;

/**
 * GET /projects/:id/commits/:commit/file-preview: how the file shows. `text` is any UTF-8 text with
 * no NUL byte, its words included (Markdown is told by its name); `image` is shown from the file
 * route; `binary` and `too-large` can only be downloaded. `size` is in bytes.
 */
export const repositoryFilePreviewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), size: z.number().int().nonnegative(), text: z.string() }),
  z.object({ kind: z.literal("image"), size: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("binary"), size: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("too-large"), size: z.number().int().nonnegative() }),
]);
export type RepositoryFilePreview = z.infer<typeof repositoryFilePreviewSchema>;

/** GET /projects/:id/remote-needs, read from the repository each time; null when the base branch tracks no remote branch. */
export const projectRemoteNeedsSchema = z.object({ remoteNeeds: remoteNeedsSchema.nullable() });
export type ProjectRemoteNeeds = z.infer<typeof projectRemoteNeedsSchema>;

/** The Project default (spec §5.4.5, "The engine cascade"): an engine type and one of its accounts. */
export const projectEngineDefaultSchema = officeDefaultSchema;
export type ProjectEngineDefault = z.infer<typeof projectEngineDefaultSchema>;

/** A model and an effort, each null for "Engine's default": the Project's force. */
export const modelEffortSchema = engineTypeSettingSchema;
export type ModelEffort = z.infer<typeof modelEffortSchema>;

/**
 * The Project's setting for one person, on each engine type, in the Role card's shape; each null is
 * "Person's setting".
 */
export const projectEnginePersonSchema = z.object({
  roleKey: z.string(),
  engineSettings: personEngineSettingsSchema,
});
export type ProjectEnginePerson = z.infer<typeof projectEnginePersonSchema>;

/**
 * A Project's own Stand-in Engine list (spec §5.4.6): while `useOwnList` is on it replaces the
 * Office's in the Project; turned off, `engineIds` is kept, unused.
 */
export const projectStandInsSchema = z.object({
  useOwnList: z.boolean(),
  engineIds: z.array(engineIdSchema),
});
export type ProjectStandIns = z.infer<typeof projectStandInsSchema>;

/** A Project's levels of both cascades (spec §5.4.5), and its Stand-in Engines. */
export const projectEngineSchema = z.object({
  /** Null is "Office's default" for both the engine type and the account. */
  default: projectEngineDefaultSchema.nullable(),
  /** Force this model and effort for everyone, on the default's engine type; null is off. */
  force: modelEffortSchema.nullable(),
  /** At most one per person; a person with nothing set on any type isn't kept. */
  people: z.array(projectEnginePersonSchema),
  standIns: projectStandInsSchema,
});
export type ProjectEngine = z.infer<typeof projectEngineSchema>;

/** A Project's Icon and Logo, by the name they go by in `/projects/:id/images/:image`. */
export const projectImageKeySchema = z.enum(["icon", "logo"]);
export type ProjectImageKey = z.infer<typeof projectImageKeySchema>;

/** The palette a version of an Icon or a Logo is for, by its name in `/projects/:id/images/:image/:palette`. */
export const projectImagePaletteSchema = z.enum(["light", "dark"]);
export type ProjectImagePalette = z.infer<typeof projectImagePaletteSchema>;

/** An Icon or a Logo in its light and dark versions; each is null when the Project holds none. */
export const projectImageVersionsSchema = z.object({
  light: imageSchema.nullable(),
  dark: imageSchema.nullable(),
});
export type ProjectImageVersions = z.infer<typeof projectImageVersionsSchema>;

/** What the Repository file browser offers for an Icon or a Logo; the contents still decide. */
export const PROJECT_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".svg"] as const;

/** POST /projects/:id/images/:image/:palette/from-repository: the file to copy, at the commit the browser showed it. */
export const projectImageFromRepositorySchema = z.object({
  commit: z.string(),
  path: z.string(),
});
export type ProjectImageFromRepository = z.infer<typeof projectImageFromRepositorySchema>;

/**
 * PUT /projects/:id/issue-settings: the Project's GitHub issue switches. A label turns the
 * auto-import on; null leaves it off.
 */
export const issueSettingsSchema = z.object({
  autoImportLabel: z.string().trim().min(1).max(50).nullable(),
  closeOnDone: z.boolean(),
  commentOnStartAndDone: z.boolean(),
  closeOnDrop: z.boolean(),
});
export type IssueSettings = z.infer<typeof issueSettingsSchema>;

/**
 * The Office's features a Project switches on or off (spec §2.1.1, "Feature switches"). Run
 * environment is the Project's Run environment setting, changed through its own route.
 */
export const PROJECT_FEATURES = [
  "connected-devices",
  "test-targets",
  "github-issues",
  "run-environment",
  "actions",
] as const;
export const projectFeatureSchema = z.enum(PROJECT_FEATURES);
export type ProjectFeature = z.infer<typeof projectFeatureSchema>;

/** Each feature on or off as the Project reads it now, Run environment's from its setting. */
export const projectFeaturesSchema = z.object({
  "connected-devices": z.boolean(),
  "test-targets": z.boolean(),
  "github-issues": z.boolean(),
  "run-environment": z.boolean(),
  actions: z.boolean(),
});
export type ProjectFeatures = z.infer<typeof projectFeaturesSchema>;

/**
 * PUT /projects/:id/features: the switches to change, others kept. Turning one on is refused while
 * a feature it needs is off; turning one off turns off those that need it.
 */
export const projectFeaturesChangeSchema = z.object({
  features: z
    .object({
      "connected-devices": z.boolean(),
      "test-targets": z.boolean(),
      "github-issues": z.boolean(),
      actions: z.boolean(),
    })
    .partial(),
});
export type ProjectFeaturesChange = z.infer<typeof projectFeaturesChangeSchema>;

/** Each Kind's own default Pipeline; null follows the Project's default Pipeline. */
export const kindDefaultPipelinesSchema = z.object({
  feature: z.string().nullable(),
  bug: z.string().nullable(),
  chore: z.string().nullable(),
});
export type KindDefaultPipelines = z.infer<typeof kindDefaultPipelinesSchema>;

/** The default Pipeline each Kind's new Tasks get, resolved: its own, else the Project's. */
export const defaultPipelineOfKindSchema = z.object({
  feature: z.string(),
  bug: z.string(),
  chore: z.string(),
});
export type DefaultPipelineOfKind = z.infer<typeof defaultPipelineOfKindSchema>;

export const projectSchema = newProjectSchema.extend({
  id: z.string().min(1),
  /** Shown in place of the mark's label and colour, in the version for the palette shown. */
  icon: projectImageVersionsSchema,
  /** The larger image on the Project's page and card, in the version for the palette shown. */
  logo: projectImageVersionsSchema,
  /** What the repository was cloned from; null for a Project added by its path. */
  repositoryUrl: z.string().nullable(),
  /** Run in the Task's worktree before Publish ships anything (spec §2.3); blank runs nothing. */
  beforePublishingCommand: z.string(),
  /** Run in the Task's worktree once Publish opened a pull request or merged; blank runs nothing. */
  afterPublishingCommand: z.string(),
  /**
   * Delete branches once merged (spec §5.5, "Deleting merged branches"): a merged Task's branch and
   * a Done, published Initiative's are deleted here and on the remote. Off by default.
   */
  deleteMergedBranches: z.boolean(),
  environment: projectEnvironmentSchema,
  useProjectSkills: z.boolean(),
  /** The keys of the repository's skills and commands turned off, each by itself; any other is on. */
  projectSkillsOff: z.array(z.string()),
  /** The Project's levels of the engine cascade and the model and effort cascade (spec §5.4.5). */
  engine: projectEngineSchema,
  runEnvironment: runEnvironmentSettingSchema,
  /** How many of the Project's Tasks may be started at once (spec §2.1). */
  projectLimit: z.int(),
  addedAt: z.iso.datetime(),
  /**
   * The name of the code host holding the repository its base branch's remote is, such as GitHub,
   * read from git's config only; null when the base branch tracks no remote or no host holds it.
   * Its issues can be imported only when it has one.
   */
  codeHost: z.string().min(1).nullable(),
  kindDefaultPipelines: kindDefaultPipelinesSchema,
  defaultPipelineOfKind: defaultPipelineOfKindSchema,
  issueSettings: issueSettingsSchema,
  features: projectFeaturesSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const projectListSchema = z.array(projectSchema);

/**
 * What a Proposal of commands changes (spec §2.3), each field as the Project had it when drafted
 * (`from`) and as proposed (`to`); the rest stay. Applying is refused once one of them changed.
 */
export const proposedProjectCommandsSchema = z.object({
  installCommand: z.object({ from: z.string(), to: z.string() }).optional(),
  installInputs: z.object({ from: z.array(z.string()), to: z.array(z.string()) }).optional(),
  /** Blank `to` clears the line. */
  beforePublishingCommand: z.object({ from: z.string(), to: z.string() }).optional(),
  /** Blank `to` clears the line. */
  afterPublishingCommand: z.object({ from: z.string(), to: z.string() }).optional(),
  /** By key: `from` null for a command added, `to` null for one removed. */
  commands: z.array(
    z.object({
      key: z.string(),
      from: projectCommandFieldsSchema.nullable(),
      to: projectCommandFieldsSchema.nullable(),
    }),
  ),
});
export type ProposedProjectCommands = z.infer<typeof proposedProjectCommandsSchema>;

/** PUT /projects/:id/install-command */
export const installCommandChangeSchema = z.object({ commandLine: z.string() });
export type InstallCommandChange = z.infer<typeof installCommandChangeSchema>;

/** PUT /projects/:id/before-publishing-command: blank clears it. */
export const beforePublishingCommandChangeSchema = z.object({ commandLine: z.string() });
export type BeforePublishingCommandChange = z.infer<typeof beforePublishingCommandChangeSchema>;

/** PUT /projects/:id/after-publishing-command: blank clears it. */
export const afterPublishingCommandChangeSchema = z.object({ commandLine: z.string() });
export type AfterPublishingCommandChange = z.infer<typeof afterPublishingCommandChangeSchema>;

/** PUT /projects/:id/commands/:key: the command's name, kind and command line, each whole. */
export const commandChangeSchema = projectCommandFieldsSchema;
export type CommandChange = z.infer<typeof commandChangeSchema>;

/** PUT /projects/:id/install-inputs */
export const installInputsChangeSchema = z.object({ installInputs: z.array(z.string()) });
export type InstallInputsChange = z.infer<typeof installInputsChangeSchema>;

/** PUT /projects/:id/environment: the whole environment, saved as it is given. */
export const environmentChangeSchema = z.object({ environment: projectEnvironmentEditSchema });
export type EnvironmentChange = z.infer<typeof environmentChangeSchema>;

/** PUT /projects/:id/publishing-mode */
export const publishingModeChangeSchema = z.object({ publishingMode: publishingModeSchema });
export type PublishingModeChange = z.infer<typeof publishingModeChangeSchema>;

/** PUT /projects/:id/delete-merged-branches */
export const deleteMergedBranchesChangeSchema = z.object({ on: z.boolean() });
export type DeleteMergedBranchesChange = z.infer<typeof deleteMergedBranchesChangeSchema>;

/** One copy of a branch a deletion takes: the local branch, or the remote's (`origin/<branch>`). */
export const branchCopySchema = z.object({
  kind: z.enum(["local", "remote"]),
  /** As the window names it: the branch, or `<remote>/<branch>`. */
  name: z.string(),
  /** The commit judged; the deletion goes only while the copy is still at it. */
  commit: z.string(),
});
export type BranchCopy = z.infer<typeof branchCopySchema>;

/** What a branch holds that its base lacks, lost once it is deleted. */
export const branchWorkSchema = z.object({
  /** Commits on the branch the base doesn't have. */
  commitCount: z.int().min(0),
  /** The newest of their subjects, at most 5. */
  subjects: z.array(z.string()),
  /** For an Initiative's branch: the titles of its Tasks landed on it that no Publish took to the base. */
  unpublishedTaskTitles: z.array(z.string()),
});
export type BranchWork = z.infer<typeof branchWorkSchema>;

/**
 * GET /tasks/:id/branch-deletion and GET /initiatives/:id/projects/:projectId/branch-deletion
 * (spec §5.5, "Deleting merged branches"): what Delete branch… would delete, judged against the
 * freshly fetched base. `holdsWork` is null when everything on it is in the base; `refusal`, when
 * given, is why it can't be deleted at all.
 */
export const branchDeletionPreviewSchema = z.object({
  branch: z.string(),
  /** The base branch it was judged against, as the window names it. */
  baseBranch: z.string(),
  copies: z.array(branchCopySchema),
  /** The Task's own worktree a deletion removes with it; null when none holds the branch. */
  worktreePath: z.string().nullable(),
  holdsWork: branchWorkSchema.nullable(),
  refusal: z.string().nullable(),
});
export type BranchDeletionPreview = z.infer<typeof branchDeletionPreviewSchema>;

/** POST …/branch-deletion: the copies as judged, and whether to delete work the base lacks. */
export const branchDeletionRequestSchema = z.object({
  expected: z.array(branchCopySchema.pick({ kind: true, commit: true })),
  deleteUnmerged: z.boolean(),
});
export type BranchDeletionRequest = z.infer<typeof branchDeletionRequestSchema>;

/** A refused deletion's 409 body. */
export const branchDeletionRefusalSchema = z.object({ reason: z.string() });
export type BranchDeletionRefusal = z.infer<typeof branchDeletionRefusalSchema>;

/** The Project page's stepper: more could never be started at once across The Office. */
export const PROJECT_LIMIT_MAX = OFFICE_WIDE_LIMIT_MAX;

/** PUT /projects/:id/project-limit */
export const projectLimitSchema = z.object({
  projectLimit: z.int().min(1).max(PROJECT_LIMIT_MAX),
});
export type ProjectLimitChange = z.infer<typeof projectLimitSchema>;

/** PUT /projects/:id/mark: the label and colour together. */
export const markChangeSchema = z.object({ mark: projectMarkSchema });
export type MarkChange = z.infer<typeof markChangeSchema>;

/** PUT /projects/:id/default-pipeline */
export const defaultPipelineChangeSchema = z.object({ defaultPipeline: z.string() });
export type DefaultPipelineChange = z.infer<typeof defaultPipelineChangeSchema>;

/** PUT /projects/:id/kind-default-pipeline: a Kind's default Pipeline; null follows the Project's default. */
export const kindDefaultPipelineChangeSchema = z.object({
  kind: taskKindSchema,
  pipelineId: z.string().nullable(),
});
export type KindDefaultPipelineChange = z.infer<typeof kindDefaultPipelineChangeSchema>;

/** GET /projects/:id/issues: an open issue on the code host, as it would import. */
export const openIssueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.url(),
  author: z.object({ login: z.string(), url: z.url() }),
  labels: z.array(z.string()),
  openedAt: z.iso.datetime(),
  /** The Kind it would import as: Bug with a bug label, else Feature. */
  kind: taskKindSchema,
});
export type OpenIssue = z.infer<typeof openIssueSchema>;

export const openIssueListSchema = z.array(openIssueSchema);

/** POST /projects/:id/issues/import: the issues to import as Tasks, by number. */
export const issueImportSchema = z.object({
  numbers: z.array(z.number().int().positive()).min(1).max(50),
});
export type IssueImport = z.infer<typeof issueImportSchema>;

/** What POST /projects/:id/issues/import answers: the Tasks made, and the issues skipped and why. */
export const issueImportResultSchema = z.object({
  imported: z.array(z.object({ number: z.number().int(), taskId: z.uuid() })),
  skipped: z.array(z.object({ number: z.number().int(), why: z.string() })),
});
export type IssueImportResult = z.infer<typeof issueImportResultSchema>;

/** The query of GET /issue-links: the Task whose issue is asked for. */
export const issueLinkQuerySchema = z.object({ taskId: z.uuid() });
export type IssueLinkQuery = z.infer<typeof issueLinkQuerySchema>;

/** GET /issue-links?taskId=: the issue a Task was imported from, or null. */
export const issueLinkSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.url(),
  author: z.object({ login: z.string(), url: z.url() }),
  importedAt: z.iso.datetime(),
  importedBy: taskCreatorSchema,
  closedOnHostAt: z.iso.datetime().nullable(),
  /** Why the last write-back to the issue failed, while it is retried; null when none failed. */
  writeBackProblem: z.string().nullable(),
});
export type IssueLink = z.infer<typeof issueLinkSchema>;

/** PUT /projects/:id/use-project-skills */
export const useProjectSkillsChangeSchema = z.object({ useProjectSkills: z.boolean() });
export type UseProjectSkillsChange = z.infer<typeof useProjectSkillsChangeSchema>;

/** PUT /projects/:id/skill-use: one skill per call, so two quick changes don't overwrite each other. */
export const projectSkillUseChangeSchema = z.object({ key: z.string().min(1), use: z.boolean() });
export type ProjectSkillUseChange = z.infer<typeof projectSkillUseChangeSchema>;

/**
 * PUT /projects/:id/engine: a field sent replaces that level, a field left out keeps what the Project
 * has, so each group of the Engine block saves on its own.
 */
export const projectEngineChangeSchema = projectEngineSchema.partial();
export type ProjectEngineChange = z.infer<typeof projectEngineChangeSchema>;

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

/** That the install command passes in that worktree. */
export const installCheckSchema = z.object({
  step: z.literal("install"),
  state: checkStateSchema,
  commandLine: z.string(),
  run: commandRunSchema.optional(),
});
export type InstallCheck = z.infer<typeof installCheckSchema>;

/** That one of the Project's commands passes in that worktree, shown by its name; it never re-runs. */
export const commandCheckSchema = projectCommandSchema.omit({ rerunCommandLine: true }).extend({
  step: z.literal("command"),
  state: checkStateSchema,
  run: commandRunSchema.optional(),
});
export type CommandCheck = z.infer<typeof commandCheckSchema>;

export const environmentCheckStateSchema = z.enum(["running", "passed", "failed", "stopped"]);
export type EnvironmentCheckState = z.infer<typeof environmentCheckStateSchema>;

/** A try of the Project's saved environment in a fresh worktree; it changes nothing. */
export const environmentCheckSchema = z.object({
  projectId: z.string(),
  environment: projectEnvironmentSchema,
  state: environmentCheckStateSchema,
  /** The worktree's check, then install, then each command in the Project's order. */
  checks: z.array(
    z.discriminatedUnion("step", [worktreeCheckSchema, installCheckSchema, commandCheckSchema]),
  ),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
});
export type EnvironmentCheck = z.infer<typeof environmentCheckSchema>;

/** GET /projects/:id/environment-check: the running check, or the last finished one. */
export const latestEnvironmentCheckSchema = z.object({ check: environmentCheckSchema.nullable() });
export type LatestEnvironmentCheck = z.infer<typeof latestEnvironmentCheckSchema>;

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
    type: z.literal("project.install-command-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.before-publishing-command-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.after-publishing-command-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.command-added"),
    projectId: z.string(),
    key: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.command-changed"),
    projectId: z.string(),
    key: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.command-removed"),
    projectId: z.string(),
    key: z.string(),
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
    type: z.literal("project.delete-merged-branches-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    /** The Run environment setting changed, or a set-up Task's Done left it as it was. */
    type: z.literal("project.run-environment-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.project-limit-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.mark-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.image-changed"),
    projectId: z.string(),
    key: projectImageKeySchema,
    palette: projectImagePaletteSchema,
  }),
  webEventSchema.extend({
    type: z.literal("project.default-pipeline-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.engine-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.use-project-skills-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.skill-use-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.test-targets-changed"),
    projectId: z.string(),
  }),
  /** The Project's Actions were added, changed or removed. */
  webEventSchema.extend({
    type: z.literal("project.actions-changed"),
    projectId: z.string(),
  }),
  /** The Project's GitHub issue switches changed. */
  webEventSchema.extend({
    type: z.literal("project.issue-settings-changed"),
    projectId: z.string(),
  }),
  /** The Project's feature switches changed. */
  webEventSchema.extend({
    type: z.literal("project.features-changed"),
    projectId: z.string(),
  }),
  /** Issues were imported as Tasks, by hand or by the auto-import. */
  webEventSchema.extend({
    type: z.literal("project.issues-imported"),
    projectId: z.string(),
  }),
  /** A Task's issue link changed: its issue closed on the code host, or a write-back failed or went through. */
  webEventSchema.extend({
    type: z.literal("issue-link.changed"),
    projectId: z.string(),
    taskId: z.uuid(),
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
    /** Null for an empty repository, whose base branch is made with its first commit as it is added. */
    defaultBranch: z.string().nullable(),
    branches: z.array(z.string()),
    /** The repository has no commits yet, so no branches. */
    empty: z.boolean(),
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

/** The Project settings whose changes are recorded (spec §6, "Project settings by Agents"). */
export const projectSettingSchema = z.enum([
  "run-environment",
  "commands",
  "environment",
  "test-targets",
  "actions",
]);
export type ProjectSetting = z.infer<typeof projectSettingSchema>;

/**
 * Who changed a Project setting: a user on the Project page, a Proposal a user applied, or a
 * person through their Office tools on a Task.
 */
export const settingChangedBySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), user: userRefSchema }),
  z.object({
    kind: z.literal("proposal"),
    proposalId: z.string(),
    /** Null for a Proposal applied before users existed. */
    user: userRefSchema.nullable(),
  }),
  z.object({
    kind: z.literal("person"),
    roleKey: z.string(),
    name: z.string(),
    title: z.string(),
    taskId: z.string(),
  }),
]);
export type SettingChangedBy = z.infer<typeof settingChangedBySchema>;

/** One recorded change: never a Secret variable's value, only names. */
export const projectSettingChangeSchema = z.object({
  id: z.string(),
  setting: projectSettingSchema,
  /** What changed, as a phrase that follows who did it: "turned Run environment On". */
  summary: z.string(),
  by: settingChangedBySchema,
  at: z.iso.datetime(),
});
export type ProjectSettingChange = z.infer<typeof projectSettingChangeSchema>;

/** GET /projects/:id/setting-changes: the Project's latest recorded setting changes, newest first. */
export const projectSettingChangesSchema = z.object({
  changes: z.array(projectSettingChangeSchema),
});
export type ProjectSettingChanges = z.infer<typeof projectSettingChangesSchema>;
