import type {
  BrokenReason as BrokenReasonResponse,
  BuiltOnBy as BuiltOnByResponse,
  BuiltStage as BuiltStageResponse,
  GateAction as GateActionResponse,
  KeptStageChange as KeptStageChangeResponse,
  OfficeWidePipeline as OfficeWidePipelineResponse,
  Pipeline as PipelineResponse,
  PipelineUse as PipelineUseResponse,
  ProjectPipeline as ProjectPipelineResponse,
  ProjectPipelineBreak as ProjectPipelineBreakResponse,
  Stage as StageResponse,
  StageProblem as StageProblemResponse,
  StageRun as StageRunResponse,
  StageRunOutcome as StageRunOutcomeResponse,
  StageTemplate as StageTemplateResponse,
  TaskStage as TaskStageResponse,
  TaskStages as TaskStagesResponse,
} from "@the-office/contracts";
import type { BuiltOnBy } from "../../application/pipeline-library.js";
import type { ProjectPipelineBreak } from "../../application/pipeline-library-editor.js";
import type { PipelineUse } from "../../domain/library-pipeline.js";
import type { Pipeline, StageProblem } from "../../domain/pipeline.js";
import type { BuiltProjectPipeline } from "../../domain/project-pipeline.js";
import type {
  BrokenReason,
  BuiltStage,
  BuiltStages,
  StageChange,
} from "../../domain/stage-change.js";
import type { Stage } from "../../domain/stage.js";
import type { StageProgress, TaskProgress } from "../../domain/stage-progress.js";
import type { GateAction, StageOutcome, StageRun } from "../../domain/stage-run.js";
import type { StageTemplate } from "../../domain/stage-template.js";
import { latestTestResults } from "../../domain/test-results.js";

export function toPipelineResponse(pipeline: Pipeline): PipelineResponse {
  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    stages: pipeline.stages.map(toStageResponse),
  };
}

/** An office-wide Pipeline with the Projects whose Project Pipelines are built from it. */
export function toOfficeWidePipelineResponse(
  pipeline: Pipeline,
  builtOnBy: readonly BuiltOnBy[],
): OfficeWidePipelineResponse {
  return {
    ...toPipelineResponse(pipeline),
    builtOnBy: builtOnBy.map(({ projectId, projectPipelines, broken }): BuiltOnByResponse => ({
      projectId,
      projectPipelines,
      broken,
    })),
  };
}

export function toPipelineUseResponse(use: PipelineUse): PipelineUseResponse {
  return {
    defaultFor: [...use.defaultFor],
    notStarted: use.notStarted,
    running: use.running,
    initiatives: use.initiatives.length,
    projectPipelines: use.projectPipelines.map(({ id, name, projectId, projectName }) => ({
      id,
      name,
      projectId,
      projectName,
    })),
  };
}

export function toProjectPipelineResponse(built: BuiltProjectPipeline): ProjectPipelineResponse {
  const { projectPipeline, basePipeline } = built;
  return {
    id: projectPipeline.id,
    projectId: projectPipeline.projectId,
    name: projectPipeline.name,
    description: projectPipeline.description,
    basePipeline: { id: basePipeline.id, name: basePipeline.name },
    stageChanges: projectPipeline.stageChanges.map(toStageChangeResponse),
    ...toBuiltStagesResponse(built),
  };
}

/** A Project Pipeline's built Stages: its rows, the Stages a Task gets, and why it is Broken. */
export function toBuiltStagesResponse({
  rows,
  stages,
  broken,
}: Pick<BuiltStages, "rows" | "stages" | "broken">): Pick<
  ProjectPipelineResponse,
  "rows" | "stages" | "broken"
> {
  return {
    rows: rows.map(toBuiltStageResponse),
    stages: stages.map(toStageResponse),
    broken: broken.map(toBrokenReasonResponse),
  };
}

export function toProjectPipelineBreakResponse(
  projectPipelineBreak: ProjectPipelineBreak,
): ProjectPipelineBreakResponse {
  return {
    projectPipelineId: projectPipelineBreak.projectPipelineId,
    name: projectPipelineBreak.name,
    projectId: projectPipelineBreak.projectId,
    projectName: projectPipelineBreak.projectName,
    reasons: projectPipelineBreak.reasons.map(toBrokenReasonResponse),
  };
}

function toBuiltStageResponse(row: BuiltStage): BuiltStageResponse {
  return {
    stage: toStageResponse(row.stage),
    origin: row.origin,
    stageChangeIndexes: [...row.stageChangeIndexes],
    baseStage: row.baseStage ? toStageResponse(row.baseStage) : null,
    changedFields: [...row.changedFields],
  };
}

function toBrokenReasonResponse(reason: BrokenReason): BrokenReasonResponse {
  return {
    stageChangeIndex: reason.stageChangeIndex ?? null,
    stageIndex: reason.stageIndex ?? null,
    stageKey: reason.stageKey ?? null,
    text: reason.text,
  };
}

function toStageChangeResponse(stageChange: StageChange): KeptStageChangeResponse {
  const named = { stageKey: stageChange.stageKey, stageName: stageChange.stageName };
  switch (stageChange.kind) {
    case "insert-before":
    case "insert-after":
    case "replace":
      return { kind: stageChange.kind, ...named, stage: toStageResponse(stageChange.stage) };
    case "change":
      return { kind: "change", ...named, fields: { ...stageChange.fields } };
    case "remove":
      return { kind: "remove", ...named };
  }
}

export function toStageTemplateResponse({ id, stage }: StageTemplate): StageTemplateResponse {
  return { id, stage: toStageResponse(stage) };
}

export function toStageProblemResponse({ stageIndex, text }: StageProblem): StageProblemResponse {
  return { stageIndex: stageIndex ?? null, text };
}

/**
 * A Task's own Stages with where each stands, and the latest result of each Stage that checks the
 * code; no Stages while the Task follows its library Pipeline.
 */
export function toTaskStagesResponse(progress: TaskProgress | undefined): TaskStagesResponse {
  if (!progress) {
    return {
      stages: null,
      editedForTask: false,
      lockedStages: 0,
      testResults: [],
      definitionOfDoneMet: [],
      definitionOfDoneOutOfReach: [],
      gatesCheckingDefinitionOfDone: [],
    };
  }
  const {
    stages,
    editedForTask,
    lockedStages,
    definitionOfDoneMet,
    definitionOfDoneOutOfReach,
    gatesCheckingDefinitionOfDone,
  } = progress;
  // Each Stage's own runs in their order, which is all the latest results are read from.
  const testResults = latestTestResults(
    stages.map(({ stage }) => stage),
    stages.flatMap(({ runs }) => runs),
  );
  return {
    stages: stages.map(toTaskStageResponse),
    editedForTask,
    lockedStages,
    testResults: testResults.map((result) => ({ ...result, detail: result.detail ?? null })),
    definitionOfDoneMet: [...definitionOfDoneMet],
    definitionOfDoneOutOfReach: definitionOfDoneOutOfReach.map(({ statement, why }) => ({
      statement,
      why,
    })),
    gatesCheckingDefinitionOfDone: [...gatesCheckingDefinitionOfDone],
  };
}

function toTaskStageResponse(progress: StageProgress): TaskStageResponse {
  return {
    stage: toStageResponse(progress.stage),
    state: progress.state,
    tokens: progress.tokens,
    wentBack: progress.wentBack ?? null,
    ...(progress.stage.kind === "agent" && progress.stage.duty !== undefined
      ? { workedBy: progress.workedBy ?? null }
      : {}),
    runs: progress.runs.map(toStageRunResponse),
  };
}

function toStageResponse(stage: Stage): StageResponse {
  const fields = { key: stage.key, name: stage.name, optional: stage.optional };
  switch (stage.kind) {
    case "agent":
      return {
        kind: "agent",
        ...fields,
        role: stage.role,
        duty: stage.duty,
        brief: stage.brief,
        session: stage.session,
        budget: stage.budget,
        effort: stage.effort,
        permissions: stage.permissions,
        onFailure: stage.onFailure,
      };
    case "script":
      return {
        kind: "script",
        ...fields,
        command: stage.command,
        publishTarget: stage.publishTarget,
        afterConflict: stage.afterConflict,
        onFailure: stage.onFailure,
      };
    case "gate":
      return { kind: "gate", ...fields };
  }
}

function toStageRunResponse(run: StageRun): StageRunResponse {
  const carried = run.carriedFailure;
  return {
    id: run.id,
    number: run.number,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    waitingSince: run.waitingSince?.toISOString() ?? null,
    threadId: run.threadId ?? null,
    session: run.session ?? null,
    tokens: run.tokens,
    context: run.context
      ? { contextTokens: run.context.tokens, contextWindow: run.context.window }
      : null,
    carriedFailure: carried
      ? { stageKey: carried.stageKey, round: carried.round, rounds: carried.rounds }
      : null,
    sentBack: run.sentBack
      ? { gateKey: run.sentBack.gateKey, feedback: run.sentBack.feedback }
      : null,
    commandRuns: run.commandRuns.map(({ purpose, commandLine, outcome, durationMs }) => ({
      purpose,
      commandLine,
      outcome,
      durationMs,
    })),
    gateAction: run.gateAction ? toGateActionResponse(run.gateAction) : null,
    outcome: run.outcome ? toOutcomeResponse(run.outcome) : null,
  };
}

function toGateActionResponse(action: GateAction): GateActionResponse {
  switch (action.kind) {
    case "continue":
      return action.feedback === undefined
        ? { kind: "continue" }
        : { kind: "continue", feedback: action.feedback };
    case "drop":
      return { kind: "drop" };
    case "send-back":
      return { kind: "send-back", stageKey: action.stageKey, feedback: action.feedback };
  }
}

function toOutcomeResponse(outcome: StageOutcome): StageRunOutcomeResponse {
  const handoverNote = outcome.handoverNote ?? null;
  switch (outcome.status) {
    case "done":
      return {
        status: "done",
        summary: outcome.summary,
        skipped: outcome.skipped ?? false,
        definitionOfDoneMet: outcome.definitionOfDoneMet ? [...outcome.definitionOfDoneMet] : null,
        pullRequestUrl: outcome.pullRequestUrl ?? null,
        handoverNote,
      };
    case "needs-decision":
      return { status: "needs-decision", question: outcome.question, handoverNote };
    case "failed":
      return {
        status: "failed",
        error: outcome.error,
        budgetReached: outcome.budgetReached ?? null,
        interrupted: outcome.interrupted ?? null,
        refusedTurn: outcome.refused
          ? {
              engineName: outcome.refused.engineName,
              windowWords: outcome.refused.windowWords,
              resetsAt: outcome.refused.resetsAt,
              sessionLeft: outcome.refused.sessionLeft,
            }
          : null,
        afterPublishingFailed: outcome.afterPublishingFailed
          ? {
              kind: outcome.afterPublishingFailed.kind,
              branch: outcome.afterPublishingFailed.branch,
              commit: outcome.afterPublishingFailed.commit,
              pullRequestUrl: outcome.afterPublishingFailed.pullRequestUrl ?? null,
            }
          : null,
        handoverNote,
      };
  }
}
