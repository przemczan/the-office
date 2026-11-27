import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import {
  LIST_PIPELINES_TOOL,
  LIST_STAGE_TEMPLATES_TOOL,
  READ_STAGE_HISTORY_TOOL,
} from "../../../conversations/index.js";
import {
  CORE_AREA,
  OfficeToolRegistry,
  RUN_PROJECT_COMMAND_TOOL,
  WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
} from "../../../engine/index.js";
import { PipelineLibrary } from "../../application/pipeline-library.js";
import { RoleFillings } from "../../application/role-fillings.js";
import { StageBranchUpdate } from "../../application/stage-branch-update.js";
import { StageHistory } from "../../application/stage-history.js";
import { CHOOSE_ROUTE_TOOL, StageRouteChoices } from "../../application/stage-route-choices.js";
import { StageProjectCommands } from "../../application/stage-project-commands.js";
import { StageRunEnvironmentDefinitions } from "../../application/stage-run-environment-definitions.js";
import { StageTemplateLibrary } from "../../application/stage-template-library.js";
import { agentCommandOf } from "../../domain/agent-command.js";
import type { ProjectPipeline } from "../../domain/project-pipeline.js";
import { agentStageWorkers, type Stage } from "../../domain/stage.js";
import { UPDATE_BRANCH_TOOL } from "../../domain/stage-commit.js";
import { dutyLabel, fillingKey } from "../../domain/stage-staffing.js";
import { STAGE_HISTORY_READ_LIMIT } from "../../domain/stage-history-words.js";
import { ProjectDefaults, type ProjectDefault } from "../../ports/project-defaults.js";
import {
  toPipelineResponse,
  toProjectPipelineResponse,
  toStageTemplateResponse,
} from "../http/pipeline-responses.js";

/**
 * The Office tools the Pipelines, Project Pipelines among them, and the Stage templates are read
 * with (spec §2.3), and the Stage tools of a Task's Agent. Changing a Pipeline or a template is the
 * Office actions of the library, ruled by the person's Authority.
 */
@Injectable()
export class PipelineOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly library: PipelineLibrary,
    private readonly projects: ProjectDefaults,
    private readonly stageTemplates: StageTemplateLibrary,
    private readonly branchUpdate: StageBranchUpdate,
    private readonly projectCommands: StageProjectCommands,
    private readonly stageHistory: StageHistory,
    private readonly runEnvironmentDefinitions: StageRunEnvironmentDefinitions,
    private readonly roleFillings: RoleFillings,
    private readonly routeChoices: StageRouteChoices,
  ) {}

  onModuleInit(): void {
    this.registerListPipelines();
    this.registerListStageTemplates();
    this.registerUpdateBranch();
    this.registerChooseRoute();
    this.registerRunProjectCommand();
    this.registerWriteRunEnvironmentDefinition();
    this.registerReadStageHistory();
  }

  private registerWriteRunEnvironmentDefinition(): void {
    this.registry.register({
      name: WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
      area: CORE_AREA,
      description:
        "Writes the Project's run environment definition into .devcontainer/ of the Task's worktree, where Write and Edit can't reach. Give devcontainer.json and the compose file or files it names, each whole, with its path from the repository's root. The Office checks the definition as it would read it, with any file it names but you don't give read from the worktree: when it is valid, it writes the files, leaving the folder's other files, and answers the service the checks run in; otherwise it writes nothing and answers every problem found. It builds and starts nothing. In a Consultation on a Task, it also commits .devcontainer/ alone on the Task's branch.",
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
      area: CORE_AREA,
      description: `Reads a Task's Stage history, as the user sees it on the Task: every Stage run in the order they ran, with its Stage, start and end, outcome, a Publish Stage's result (such as "Published: pull request #212 opened"), Handover note, Decisions and their answers, engine, model and tokens, every Project command it ran with its outcome, exit code, duration and filtered output, and for an Agent Stage's run how many messages its Stage Thread logged. Give a run's number as well to read that run with each command's whole output and, for an Agent Stage, its Stage Thread's messages from the run's start to its end: what the Agent said and tried, with its speakers, tool activity as one line each, and Decisions. One answer holds at most ${STAGE_HISTORY_READ_LIMIT} characters. It reads only The Office's records, never a file or an engine's transcript.`,
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
      area: CORE_AREA,
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
      area: CORE_AREA,
      description:
        "Asks The Office to bring the Task's branch up to date with the base branch: it commits your work so far and merges the base in. A conflict stays in the worktree for you to resolve by editing the files; The Office commits the merge when your Stage ends. It waits until the update and any install are done.",
      input: z.object({}),
      run: (_input, { sessionId }) => this.branchUpdate.inSession(sessionId),
    });
  }

  private registerChooseRoute(): void {
    this.registry.register({
      name: CHOOSE_ROUTE_TOOL,
      area: CORE_AREA,
      description:
        "Chooses the route your Agent Stage's work goes on by, one of the choices its Routes out section lists, with your reason. The walk follows it only once the Stage ends done; a failed Stage follows its When it fails route. You may choose again before you end, and the last choice counts. A route that isn't one of the Stage's choices is refused, naming those you may choose.",
      input: z.object({
        route: z
          .string()
          .describe("The route's target, by its Stage key as Routes out lists it, or end for End."),
        reason: z.string().describe("Why you choose it, in a sentence or two."),
      }),
      run: ({ route, reason }, { sessionId }) =>
        this.routeChoices.inSession(sessionId, { route, reason }),
    });
  }

  private registerListPipelines(): void {
    this.registry.register({
      name: LIST_PIPELINES_TOOL,
      area: CORE_AREA,
      description:
        "Lists the Pipelines as JSON: the office-wide Pipelines of the library, each with its id, name, description and Stages in the Pipeline's order, each Stage with its routes out and their conditions (an Agent Stage's choices among them, each a choice test with its words) and its position on the editor's canvas, and where End stands (`endPosition`) when it was moved, in the shape add_library_pipeline and change_library_pipeline take them; then the Project Pipelines, each a full Pipeline of its Project, with its id, Project, name, description, the Pipeline it was copied from (its name, and when, null when unknown) and its Stages in the same shape, which change_project_pipeline takes; one Broken before The Office updated says so, with its reasons, and can't be chosen until the user saves it once; then, for each duty an Agent Stage names instead of a Role, by its key, who holds it, whom the Stage runs as when it starts. Give a Project to list only its Project Pipelines, or a Pipeline to list only that one, office-wide or a Project's, with its duties.",
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
        const projectPipelines = allProjectPipelines.filter(({ id }) => isListed(id));
        if (pipelineId !== undefined && officeWide.length + projectPipelines.length === 0) {
          return { text: `There is no Pipeline "${pipelineId}".`, isError: true };
        }
        const listed = {
          officeWidePipelines: officeWide.map(toPipelineResponse),
          projectPipelines: projectPipelines.map((projectPipeline) =>
            listedProjectPipeline(projectPipeline, projects),
          ),
          duties: await this.dutyWords([
            ...officeWide.flatMap(({ stages }) => stages),
            ...projectPipelines.flatMap(({ stages }) => stages),
          ]),
        };
        return { text: JSON.stringify(listed, null, 2), isError: false };
      },
    });
  }

  private registerListStageTemplates(): void {
    this.registry.register({
      name: LIST_STAGE_TEMPLATES_TOOL,
      area: CORE_AREA,
      description:
        "Lists the Stage templates as JSON: each template's id and Stage, in the shape add_stage_template and change_stage_template take it; then, for each duty a Stage names instead of a Role, by its key, who holds it, whom the Stage runs as when it starts.",
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
}

/**
 * A Project Pipeline as list_pipelines lists it: its Project by name too, where it was copied from,
 * and, only when it has them, why it was Broken before The Office updated.
 */
function listedProjectPipeline(
  projectPipeline: ProjectPipeline,
  projects: readonly ProjectDefault[],
) {
  const { projectId, copiedFrom, brokenBeforeUpdate, ...listed } =
    toProjectPipelineResponse(projectPipeline);
  const projectName = projects.find(({ id }) => id === projectId)?.name ?? projectId;
  return {
    ...listed,
    project: { id: projectId, name: projectName },
    copiedFrom,
    ...(brokenBeforeUpdate === null
      ? {}
      : {
          brokenBeforeUpdate: {
            words:
              "Broken before The Office updated: it can't be chosen until the user saves it once.",
            reasons: brokenBeforeUpdate,
          },
        }),
  };
}
