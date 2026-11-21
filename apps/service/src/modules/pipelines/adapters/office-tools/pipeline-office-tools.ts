import { Injectable, type OnModuleInit } from "@nestjs/common";
import { stageChangeSchema, stageSchema } from "@the-office/contracts";
import { z } from "zod";
import {
  LIST_PIPELINES_TOOL,
  LIST_STAGE_TEMPLATES_TOOL,
  PROPOSE_LIBRARY_PIPELINE_TOOL,
  PROPOSE_PROJECT_PIPELINE_TOOL,
  PROPOSE_STAGE_TEMPLATE_TOOL,
  ProposalRefused,
  READ_STAGE_HISTORY_TOOL,
} from "../../../conversations/index.js";
import {
  OfficeToolRegistry,
  RUN_PROJECT_COMMAND_TOOL,
  WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
  type OfficeToolResult,
} from "../../../engine/index.js";
import {
  PipelineLibraryEditor,
  type ProjectPipelineBreak,
} from "../../application/pipeline-library-editor.js";
import { PipelineLibrary } from "../../application/pipeline-library.js";
import { RoleFillings } from "../../application/role-fillings.js";
import { StageBranchUpdate } from "../../application/stage-branch-update.js";
import { StageHistory } from "../../application/stage-history.js";
import { StageProjectCommands } from "../../application/stage-project-commands.js";
import { StageRunEnvironmentDefinitions } from "../../application/stage-run-environment-definitions.js";
import { StageTemplateLibrary } from "../../application/stage-template-library.js";
import { agentCommandOf } from "../../domain/agent-command.js";
import { placedInOrder } from "../../domain/flow.js";
import { proposedEdit } from "../../domain/library-pipeline.js";
import type { StageProblem } from "../../domain/pipeline.js";
import type { BuiltProjectPipeline } from "../../domain/project-pipeline.js";
import {
  proposedRoutes,
  routeChangeWords,
  type ProposedRoutes,
} from "../../domain/proposed-routes.js";
import { namedRoutes } from "../../domain/route.js";
import { agentStageWorkers, type Stage } from "../../domain/stage.js";
import { UPDATE_BRANCH_TOOL } from "../../domain/stage-commit.js";
import { dutyLabel, fillingKey } from "../../domain/stage-staffing.js";
import { STAGE_HISTORY_READ_LIMIT } from "../../domain/stage-history-words.js";
import { ProjectDefaults, type ProjectDefault } from "../../ports/project-defaults.js";
import { ProposalDrafts, type ProjectPipelineFields } from "../../ports/proposal-drafts.js";
import {
  toPipelineResponse,
  toProjectPipelineResponse,
  toStageTemplateResponse,
} from "../http/pipeline-responses.js";

const PIPELINE_DRAFTED =
  "The Proposal is in this Thread as a card, with the Pipeline's Stages and routes now and as proposed; nothing changes until the user applies it, and it is refused if the Stages change first. Don't wait for it: tell the user what you propose and why, in a line or two.";

const PROJECT_PIPELINE_DRAFTED =
  "The Proposal is in this Thread as a card, with the Project Pipeline's fields and routes now and as proposed; nothing changes until the user applies it, and it is refused if the Project Pipeline changes first. It never sets the Project's default Pipeline: the user does that on the Project's page. Don't wait for it: tell the user what you propose and why, in a line or two.";

/** How a Stage's routes and their conditions are given, which both propose tools take. */
const ROUTES_WORDS = [
  "Each Stage's routes are weighed in order, and the walk follows the first whose condition holds: a route leads to a later Stage by its key (`to`), or to End with `to` null, and a condition null holds always, so the last route usually carries none.",
  'A condition is a group, `combine` "all" (every test in it holds) or "any" (one does), of tests and nested groups: a Stage test `{ "kind": "stage", "stage": <key>, "is": … }`, where the key is the route\'s own Stage or an earlier one, or null for the route\'s own, and `is` is "done" (it ended Done), "failed" (it ended Failed), "skipped", "changed" (it changed files), "unchanged" (it changed no files), or "ran" with `times`, holding once it ran that many times or more; a Definition of Done test `{ "kind": "definitionOfDone", "is": "all-met" | "some-not-met" }`; or a Project command test `{ "kind": "command", "key": <the Project\'s command key> }`, which holds when that command exits 0.',
].join(" ");

/** The worked example both propose tools give. */
const ROUTES_EXAMPLE =
  'For example, "run Review only when Tests changed files or ended Failed, otherwise Publish" gives the Tests Stage the routes `[{ "to": "review", "condition": { "combine": "any", "tests": [{ "kind": "stage", "stage": null, "is": "changed" }, { "kind": "stage", "stage": null, "is": "failed" }] } }, { "to": "publish", "condition": null }]`, Review the routes `[{ "to": "publish", "condition": null }]`, and Publish `[{ "to": null, "condition": null }]`.';

/** What both propose tools do before drafting. */
const CHECKED_WORDS =
  "The Office runs the editor's check on it first: a draft that breaks a rule is refused with every problem, each naming its Stage and the rule, for you to fix and propose again; one with only warnings is drafted, and you are told the warnings.";

const STAGE_TEMPLATE_DRAFTED =
  "The Proposal is in this Thread as a card, with the template's Stage now and as proposed; nothing changes until the user applies it, and it is refused if the template changes first. Don't wait for it: tell the user what you propose and why, in a line or two.";

/**
 * The Office tools Devops reads the Pipelines, Project Pipelines among them, and the Stage templates
 * with, and proposes a library Pipeline's new Stages, a Project Pipeline, new or changed, or a
 * template's new Stage with (spec §2.3). Proposing changes
 * nothing itself, so it sits behind no Hard switch: the user's click on the Proposal is the
 * approval. They all return at once.
 */
@Injectable()
export class PipelineOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly library: PipelineLibrary,
    private readonly editor: PipelineLibraryEditor,
    private readonly projects: ProjectDefaults,
    private readonly stageTemplates: StageTemplateLibrary,
    private readonly proposals: ProposalDrafts,
    private readonly branchUpdate: StageBranchUpdate,
    private readonly projectCommands: StageProjectCommands,
    private readonly stageHistory: StageHistory,
    private readonly runEnvironmentDefinitions: StageRunEnvironmentDefinitions,
    private readonly roleFillings: RoleFillings,
  ) {}

  onModuleInit(): void {
    this.registerListPipelines();
    this.registerProposePipeline();
    this.registerProposeProjectPipeline();
    this.registerListStageTemplates();
    this.registerProposeStageTemplate();
    this.registerUpdateBranch();
    this.registerRunProjectCommand();
    this.registerWriteRunEnvironmentDefinition();
    this.registerReadStageHistory();
  }

  private registerWriteRunEnvironmentDefinition(): void {
    this.registry.register({
      name: WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
      description:
        "Writes the Project's run environment definition into .devcontainer/ of the Task's worktree, where Write and Edit can't reach. Give devcontainer.json and the compose file or files it names, each whole, with its path from the repository's root. The Office checks the definition as it would read it, with any file it names but you don't give read from the worktree: when it is valid, it writes the files, leaving the folder's other files, and answers the service the checks run in; otherwise it writes nothing and answers every problem found. It builds and starts nothing.",
      input: z.object({
        files: z
          .array(
            z.object({
              path: z
                .string()
                .describe(
                  "The file's path from the repository's root, inside .devcontainer/, such as .devcontainer/devcontainer.json.",
                ),
              text: z.string().describe("The file's whole text."),
            }),
          )
          .describe(
            "The files to write: devcontainer.json and its compose files, and any other the folder needs.",
          ),
      }),
      run: ({ files }, call) => this.runEnvironmentDefinitions.inSession(files, call),
    });
  }

  private registerReadStageHistory(): void {
    this.registry.register({
      name: READ_STAGE_HISTORY_TOOL,
      description: `Reads a Task's Stage history, as the user sees it on the Task: every Stage run in the order they ran, with its Stage, start and end, outcome, Handover note, Decisions and their answers, engine, model and tokens, every Project command it ran with its outcome, exit code, duration and filtered output, and for an Agent Stage's run how many messages its Stage Thread logged. Give a run's number as well to read that run with each command's whole output and, for an Agent Stage, its Stage Thread's messages from the run's start to its end: what the Agent said and tried, with its speakers, tool activity as one line each, and Decisions. One answer holds at most ${STAGE_HISTORY_READ_LIMIT} characters. It reads only The Office's records, never a file or an engine's transcript.`,
      input: z.object({
        taskId: z.string().describe("The Task's id, as list_tasks gives it."),
        runNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "One run's number, as the whole history gives it, to read its whole outputs and its Stage Thread's messages.",
          ),
      }),
      run: async ({ taskId, runNumber }) => ({
        text:
          runNumber === undefined
            ? await this.stageHistory.of(taskId.trim())
            : await this.stageHistory.run(taskId.trim(), runNumber),
        isError: false,
      }),
    });
  }

  private registerRunProjectCommand(): void {
    this.registry.register({
      name: RUN_PROJECT_COMMAND_TOOL,
      description:
        "Runs one of the Project's commands by its key, or a command line you write, such as one test file, in the worktree's root, where the Project's commands run: in the Task's run environment when the Project has one, waiting for a free one. Give exactly one of command and commandLine. A command line runs only if your shell may run it. It waits until the command ends and answers with its exit code and the path of a file with its whole output, which you read with Read.",
      input: z.object({
        command: z
          .string()
          .optional()
          .describe(
            "install, or one of the Project's commands by its key as your Brief lists them, run exactly as its settings say.",
          ),
        commandLine: z
          .string()
          .optional()
          .describe(
            "A command line for the platform's shell, run in the worktree's root, such as the test command with one test file.",
          ),
      }),
      run: ({ command, commandLine }, call) => {
        const asked = agentCommandOf(command, commandLine);
        return typeof asked === "string"
          ? Promise.resolve({ text: asked, isError: true })
          : this.projectCommands.inSession(asked, call);
      },
    });
  }

  private registerUpdateBranch(): void {
    this.registry.register({
      name: UPDATE_BRANCH_TOOL,
      description:
        "Asks The Office to bring the Task's branch up to date with the base branch: it commits your work so far and merges the base in. A conflict stays in the worktree for you to resolve by editing the files; The Office commits the merge when your Stage ends. It waits until the update and any install are done.",
      input: z.object({}),
      run: (_input, { sessionId }) => this.branchUpdate.inSession(sessionId),
    });
  }

  private registerListPipelines(): void {
    this.registry.register({
      name: LIST_PIPELINES_TOOL,
      description:
        "Lists the Pipelines as JSON: the office-wide Pipelines of the library, each with its id, name, description and Stages in the Pipeline's order, each Stage with its routes out and their conditions and its place on the editor's canvas, in the shape propose_library_pipeline takes them; then the Project Pipelines, each with its id, Project, name, description, base Pipeline (an office-wide one, by id and name), Stage changes (Change routes among them), built Stages with their routes, and Broken with its reasons (empty when it isn't), in the shape propose_project_pipeline takes them; then, for each duty an Agent Stage names instead of a Role, by its key, who holds it, whom the Stage runs as when it starts. Give a Project to list only its Project Pipelines, or a Pipeline to list only that one, office-wide or a Project's, with its duties.",
      input: z.object({
        project: z
          .string()
          .optional()
          .describe(
            "A Project's id, to list only its Project Pipelines; every Project's when left out.",
          ),
        pipeline: z
          .string()
          .optional()
          .describe(
            "A Pipeline's id, office-wide or a Project Pipeline's, to list only that Pipeline; every Pipeline when left out.",
          ),
      }),
      run: async ({ project, pipeline }) => {
        // An empty id means every Project or Pipeline, as one left out does.
        const projectId = project?.trim() || undefined;
        const pipelineId = pipeline?.trim() || undefined;
        const projects = await this.projects.list();
        if (projectId !== undefined && !projects.some(({ id }) => id === projectId)) {
          return { text: `There is no Project "${projectId}".`, isError: true };
        }
        const [allOfficeWide, allProjectPipelines] = await Promise.all([
          this.library.list(),
          this.library.projectPipelines(projectId),
        ]);
        const isListed = (id: string): boolean => pipelineId === undefined || id === pipelineId;
        const officeWide = allOfficeWide.filter(({ id }) => isListed(id));
        const projectPipelines = allProjectPipelines.filter(({ projectPipeline }) =>
          isListed(projectPipeline.id),
        );
        if (pipelineId !== undefined && officeWide.length + projectPipelines.length === 0) {
          return { text: `There is no Pipeline "${pipelineId}".`, isError: true };
        }
        const listed = {
          officeWidePipelines: officeWide.map(toPipelineResponse),
          projectPipelines: projectPipelines.map((built) => listedProjectPipeline(built, projects)),
          duties: await this.dutyWords([
            ...officeWide.flatMap(({ stages }) => stages),
            ...projectPipelines.flatMap(({ stages }) => stages),
          ]),
        };
        return { text: JSON.stringify(listed, null, 2), isError: false };
      },
    });
  }

  private registerProposePipeline(): void {
    this.registry.register({
      name: PROPOSE_LIBRARY_PIPELINE_TOOL,
      description: [
        "Drafts an office-wide Pipeline's whole new flow as a Proposal the user applies with a click: its Stages, where each stands, and their routes with their conditions; its name and description stay.",
        ROUTES_WORDS,
        "A Stage's `place` (`column`, `row`) is where it stands on the editor's canvas, which gives the Pipeline's order, the columns left to right; leave every place out to have the Stages stand one to a column in the order given. Stages that all leave their routes out are taken as a straight line, each to the next.",
        ROUTES_EXAMPLE,
        CHECKED_WORDS,
        "It shows in this Thread as a card, with each Stage whose routes change, its routes as they were and as proposed, and changes nothing until the user applies it. It returns at once.",
      ].join(" "),
      input: z.object({
        pipeline: z.string().describe("The Pipeline's id, as list_pipelines gives it."),
        stages: z
          .array(stageSchema)
          .describe(
            "The Pipeline's Stages as they should be, all of them, each with its routes and place, in the shape list_pipelines gives them. A Script Stage's command is publish, for Publish, or a Project command by its key, never install; every Project with the Pipeline as default, or with a Task on it that hasn't started, must have each key it names, a command test's among them.",
          ),
      }),
      run: async ({ pipeline: pipelineId, stages }, { sessionId }) => {
        const pipeline = await this.library.find(pipelineId.trim());
        if (!pipeline) {
          return { text: `The library has no Pipeline "${pipelineId}".`, isError: true };
        }
        const to = placedInOrder(stages);
        const check = await this.editor.check(proposedEdit(pipeline, to), pipeline.id);
        if (check.problems.length > 0) return refusedWords(check.problems);
        const routes = proposedRoutes(placedInOrder(pipeline.stages), to, check.flags);
        const answer = await drafted(PIPELINE_DRAFTED, () =>
          this.proposals.draft(sessionId, {
            kind: "pipeline",
            pipelineId: pipeline.id,
            from: pipeline.stages,
            to,
            routes,
          }),
        );
        if (answer.isError) return answer;
        return draftedWords(answer.text, routes, breakWords(check.breaks));
      },
    });
  }

  private registerProposeProjectPipeline(): void {
    this.registry.register({
      name: PROPOSE_PROJECT_PIPELINE_TOOL,
      description: [
        "Drafts a new Project Pipeline of a Project, or a change to one, as a Proposal the user applies with a click: its name, description, base Pipeline and Stage changes.",
        'A Change routes Stage change, `{ "kind": "change-routes", "stageKey": <key>, "routes": [...] }`, gives one of its built Stages its whole list of routes out, with their conditions; a Stage an Insert or Replace gives carries its own routes and place.',
        ROUTES_WORDS,
        ROUTES_EXAMPLE,
        CHECKED_WORDS,
        "It shows in this Thread as a card, each value now and as proposed, with each built Stage whose routes change, its routes as they were and as proposed, and changes nothing until the user applies it. It never removes a Project Pipeline or sets a Project's default. It returns at once.",
      ].join(" "),
      input: z.object({
        project: z.string().describe("The Project's id."),
        pipeline: z
          .string()
          .optional()
          .describe(
            "The Project Pipeline's id, as list_pipelines gives it, to change it; left out for a new one.",
          ),
        name: z
          .string()
          .optional()
          .describe(
            "Its name, unique among the office-wide Pipelines and the Project's own. A new one needs it; a change keeps the name when it is left out.",
          ),
        description: z
          .string()
          .optional()
          .describe("Its description; empty for a new one, kept for a change, when left out."),
        basePipeline: z
          .string()
          .optional()
          .describe(
            "The office-wide Pipeline it is built from, by its id as list_pipelines gives it, never a Project Pipeline. A new one needs it; a change keeps its base Pipeline when it is left out.",
          ),
        stageChanges: z
          .array(stageChangeSchema)
          .optional()
          .describe(
            "Its Stage changes as they should be, all of them in order, in the shape list_pipelines gives them, each naming its Stage by key: a Stage of the base Pipeline, or one an earlier Stage change inserted. None for a new one, kept for a change, when left out. The built Stages must not be Broken, and the Project must have each command key they name.",
          ),
      }),
      run: async (input, { sessionId }) => {
        const projectId = input.project.trim();
        const pipelineId = input.pipeline?.trim();
        let from: ProjectPipelineFields | null = null;
        let builtBefore: readonly Stage[] | undefined;
        if (pipelineId !== undefined) {
          const saved = await this.library.projectPipeline(pipelineId);
          if (!saved || saved.projectPipeline.projectId !== projectId) {
            return {
              text: `Project "${projectId}" has no Project Pipeline "${pipelineId}".`,
              isError: true,
            };
          }
          from = fieldsOf(saved);
          builtBefore = saved.stages;
        }
        const name = input.name ?? from?.name;
        const basePipelineId = input.basePipeline?.trim() ?? from?.basePipelineId;
        if (name === undefined || basePipelineId === undefined) {
          return {
            text: "A new Project Pipeline needs its name and its base Pipeline.",
            isError: true,
          };
        }
        const edit: ProjectPipelineFields = {
          name,
          description: input.description ?? from?.description ?? "",
          basePipelineId,
          stageChanges: input.stageChanges ?? from?.stageChanges ?? [],
        };
        const check = await this.editor.checkProjectPipeline(edit, {
          projectId,
          ...(pipelineId === undefined ? {} : { projectPipelineId: pipelineId }),
        });
        if (check.problems.length > 0 || !check.built) return refusedWords(check.problems);
        const to = withRoutesNamed(edit, check.built.stages);
        // A new one's routes change from its base Pipeline's.
        const before = builtBefore ?? (await this.library.find(basePipelineId))?.stages ?? [];
        const routes = proposedRoutes(
          placedInOrder(before),
          placedInOrder(check.built.stages),
          check.flags,
        );
        const answer = await drafted(PROJECT_PIPELINE_DRAFTED, () =>
          this.proposals.draft(sessionId, {
            kind: "project-pipeline",
            projectId,
            pipelineId: pipelineId ?? null,
            from,
            to,
            routes,
          }),
        );
        if (answer.isError) return answer;
        return draftedWords(answer.text, routes, []);
      },
    });
  }

  private registerListStageTemplates(): void {
    this.registry.register({
      name: LIST_STAGE_TEMPLATES_TOOL,
      description:
        "Lists the Stage templates as JSON: each template's id and Stage, in the shape propose_stage_template takes it; then, for each duty a Stage names instead of a Role, by its key, who holds it, whom the Stage runs as when it starts.",
      input: z.object({}),
      run: async () => {
        const templates = await this.stageTemplates.list();
        const listed = {
          templates: templates.map(toStageTemplateResponse),
          duties: await this.dutyWords(templates.map(({ stage }) => stage)),
        };
        return { text: JSON.stringify(listed, null, 2), isError: false };
      },
    });
  }

  /**
   * Who holds each duty `stages` name, by its key, such as "Implements (Ada · Developer)": a Stage
   * naming a duty runs as its holder when it starts (spec §2.3).
   */
  private async dutyWords(stages: readonly Stage[]): Promise<Record<string, string>> {
    const fillings = await this.roleFillings.of(stages);
    return Object.fromEntries(
      [...agentStageWorkers(stages).duties].map((duty) => {
        const filling = fillings.get(fillingKey({ duty }));
        const holder = filling?.person
          ? `${filling.person.name} · ${filling.title}`
          : "nobody holds it";
        return [duty, `${dutyLabel(duty)} (${holder})`];
      }),
    );
  }

  private registerProposeStageTemplate(): void {
    this.registry.register({
      name: PROPOSE_STAGE_TEMPLATE_TOOL,
      description:
        "Drafts a new Stage for a Stage template as a Proposal the user applies with a click. It shows in this Thread as a card, with the Stage now and the one proposed, and changes nothing until the user applies it. A template keeps no loop target. It returns at once.",
      input: z.object({
        template: z.string().describe("The template's id, as list_stage_templates gives it."),
        stage: stageSchema.describe(
          "The template's Stage as it should be, whole, in the shape list_stage_templates gives it.",
        ),
      }),
      run: async ({ template: templateId, stage }, { sessionId }) => {
        const template = await this.stageTemplates.find(templateId.trim());
        if (!template) {
          return { text: `There is no Stage template "${templateId}".`, isError: true };
        }
        return drafted(STAGE_TEMPLATE_DRAFTED, () =>
          this.proposals.draft(sessionId, {
            kind: "stage-template",
            templateId: template.id,
            from: template.stage,
            to: stage,
          }),
        );
      },
    });
  }
}

/** A Project Pipeline as list_pipelines lists it: its Project by name too, its rows left out. */
function listedProjectPipeline(built: BuiltProjectPipeline, projects: readonly ProjectDefault[]) {
  const { rows: _rows, projectId, broken, ...listed } = toProjectPipelineResponse(built);
  const projectName = projects.find(({ id }) => id === projectId)?.name ?? projectId;
  return {
    ...listed,
    project: { id: projectId, name: projectName },
    broken: broken.map(({ text }) => text),
  };
}

/** The Project Pipeline's fields as a Proposal of it starts from. */
function fieldsOf({ projectPipeline }: BuiltProjectPipeline): ProjectPipelineFields {
  const { name, description, basePipelineId, stageChanges } = projectPipeline;
  return { name, description, basePipelineId, stageChanges };
}

/** What Devops is told of the Project Pipelines a Proposal of the base Pipeline's Stages breaks. */
function breakWords(breaks: readonly ProjectPipelineBreak[]): string[] {
  if (breaks.length === 0) return [];
  return [
    "Applying it leaves these Project Pipelines Broken, as the card warns the user; each stays Broken until its Stage changes are fixed:",
    ...breaks.map(
      ({ projectName, name, reasons }) =>
        `- ${projectName}'s ${name}: ${reasons.map(({ text }) => text).join(" ")}`,
    ),
  ];
}

/** A Project Pipeline's fields with each Change routes naming the Stages by their built names. */
function withRoutesNamed(
  fields: ProjectPipelineFields,
  built: readonly Stage[],
): ProjectPipelineFields {
  const names = new Map(built.map(({ key, name }) => [key, name]));
  return {
    ...fields,
    stageChanges: fields.stageChanges.map((stageChange) =>
      stageChange.kind === "change-routes"
        ? { ...stageChange, routes: namedRoutes(stageChange.routes, names) }
        : stageChange,
    ),
  };
}

/** What the Agent is told of a draft the check refused: every problem, on its Stage. */
function refusedWords(problems: readonly StageProblem[]): OfficeToolResult {
  return {
    text: [
      "Nothing was drafted: the check refuses it. Fix each of these and propose it again:",
      ...problems.map(({ text }) => `- ${text}`),
    ].join("\n"),
    isError: true,
  };
}

/** What the Agent is told of a draft: its route changes, the check's warnings and `more`. */
function draftedWords(
  draftedText: string,
  { stages, check }: ProposedRoutes,
  more: readonly string[],
): OfficeToolResult {
  const lines = [draftedText];
  if (stages.length > 0) lines.push("Its route changes:", ...routeChangeWords(stages));
  if (check.length > 0) {
    lines.push(
      "The check warns of these, which don't refuse it; tell the user of them:",
      ...check.map(({ text }) => `- ${text}`),
    );
  }
  return { text: [...lines, ...more].join("\n"), isError: false };
}

/** Drafts with `draft`, answering the Agent `draftedText`, or with why it was refused. */
async function drafted(
  draftedText: string,
  draft: () => Promise<unknown>,
): Promise<OfficeToolResult> {
  try {
    await draft();
    return { text: draftedText, isError: false };
  } catch (error) {
    if (error instanceof ProposalRefused) return { text: error.message, isError: true };
    throw error;
  }
}
