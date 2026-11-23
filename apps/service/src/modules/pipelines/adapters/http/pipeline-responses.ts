import type {
  ConditionGroup as ConditionGroupResponse,
  GateAction as GateActionResponse,
  LinkedStage as LinkedStageResponse,
  Pipeline as PipelineResponse,
  PipelineUse as PipelineUseResponse,
  ProjectPipeline as ProjectPipelineResponse,
  Route as RouteResponse,
  Stage as StageResponse,
  StageProblem as StageProblemResponse,
  StageProblemAt as StageProblemAtResponse,
  StageRun as StageRunResponse,
  StageRunOutcome as StageRunOutcomeResponse,
  StageTemplate as StageTemplateResponse,
  TaskStage as TaskStageResponse,
  TaskStages as TaskStagesResponse,
} from "@the-office/contracts";
import type { LinkedStage } from "../../application/linked-stages.js";
import type { PipelineUse } from "../../domain/library-pipeline.js";
import type { Pipeline, StageProblem, StageProblemAt } from "../../domain/pipeline.js";
import type { FollowedRoute } from "../../domain/pipeline-walk.js";
import { isConditionGroup, type ConditionGroup, type Route } from "../../domain/route.js";
import type { ProjectPipeline } from "../../domain/project-pipeline.js";
import { publishResultOf, type PublishResult } from "../../domain/publish-result.js";
import { isPublishStage, type Stage } from "../../domain/stage.js";
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

export function toPipelineUseResponse(use: PipelineUse): PipelineUseResponse {
  return {
    defaultFor: [...use.defaultFor],
    notStarted: use.notStarted,
    running: use.running,
    initiatives: use.initiatives.length,
  };
}

export function toProjectPipelineResponse(
  projectPipeline: ProjectPipeline,
): ProjectPipelineResponse {
  const { projectId, copiedFrom, brokenBeforeUpdate } = projectPipeline;
  return {
    ...toPipelineResponse(projectPipeline),
    projectId,
    copiedFrom: { name: copiedFrom.name, at: copiedFrom.at?.toISOString() ?? null },
    brokenBeforeUpdate: brokenBeforeUpdate ? [...brokenBeforeUpdate] : null,
  };
}

/** A route as answered: always with its limit, which only a given route may leave out. */
function toRouteResponse({ to, toName, condition, limit }: Route): RouteResponse {
  return {
    to,
    ...(toName === undefined ? {} : { toName }),
    condition: condition ? toConditionGroupResponse(condition) : null,
    limit,
  };
}

function toConditionGroupResponse({ combine, tests }: ConditionGroup): ConditionGroupResponse {
  return {
    combine,
    tests: tests.map((test) =>
      isConditionGroup(test) ? toConditionGroupResponse(test) : { ...test },
    ),
  };
}

export function toStageTemplateResponse({ id, stage }: StageTemplate): StageTemplateResponse {
  return { id, stage: toStageResponse(stage) };
}

export function toLinkedStageResponse({
  pipelineId,
  pipelineName,
  projectId,
  stage,
}: LinkedStage): LinkedStageResponse {
  return { pipelineId, pipelineName, projectId, stage: toStageResponse(stage) };
}

export function toStageProblemResponse({
  stageKey,
  at,
  level,
  text,
}: StageProblem): StageProblemResponse {
  return {
    stageKey: stageKey ?? null,
    at: at ? toStageProblemAtResponse(at) : null,
    level,
    text,
  };
}

function toStageProblemAtResponse(at: StageProblemAt): StageProblemAtResponse {
  if (at.kind === "stage") return { kind: "stage" };
  const { routeIndex, testPath } = at;
  return { kind: "route", routeIndex, ...(testPath ? { testPath: [...testPath] } : {}) };
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
    runs: progress.runs.map((run) =>
      toStageRunResponse(run, progress.routes.get(run.id), isPublishStage(progress.stage)),
    ),
  };
}

function toStageResponse(stage: Stage): StageResponse {
  const fields = {
    key: stage.key,
    name: stage.name,
    optional: stage.optional,
    ...(stage.routes ? { routes: stage.routes.map(toRouteResponse) } : {}),
    ...(stage.place ? { place: { ...stage.place } } : {}),
    ...(stage.templateId !== undefined ? { templateId: stage.templateId } : {}),
  };
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
        contextLimits: stage.contextLimits,
        mergeBaseFirst: stage.mergeBaseFirst,
      };
    case "script":
      return { kind: "script", ...fields, command: stage.command };
    case "gate":
      return { kind: "gate", ...fields };
    case "publish":
      return { kind: "publish", ...fields, publishTarget: stage.publishTarget };
  }
}

/** A run of a Stage, `ofPublish` when the Stage is a Publish Stage, whose outcome names its result. */
function toStageRunResponse(
  run: StageRun,
  route: FollowedRoute | undefined,
  ofPublish: boolean,
): StageRunResponse {
  const carried = run.carriedFailure;
  return {
    id: run.id,
    number: run.number,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    waitingSince: run.waitingSince?.toISOString() ?? null,
    threadId: run.threadId ?? null,
    session: run.session ?? null,
    engine: toStageRunEngineResponse(run),
    engineSwitches: run.engineSwitches.map(({ chosenBy, ...engineSwitch }) => ({
      ...engineSwitch,
      chosenBy: chosenBy ? { userId: chosenBy.userId, name: chosenBy.name } : null,
    })),
    tokens: run.tokens,
    context: run.context
      ? { contextTokens: run.context.tokens, contextWindow: run.context.window }
      : null,
    carriedFailure: carried
      ? { stageKey: carried.stageKey, round: carried.round, rounds: carried.rounds }
      : null,
    route: route ? { to: route.to, times: route.times, limit: route.limit } : null,
    sentBack: run.sentBack
      ? { gateKey: run.sentBack.gateKey, feedback: run.sentBack.feedback }
      : null,
    commandRuns: run.commandRuns.map(
      ({ purpose, commandLine, outcome, durationMs, condition }) => ({
        purpose,
        commandLine,
        outcome,
        durationMs,
        ...(condition && { condition: { to: condition.to } }),
      }),
    ),
    gateAction: run.gateAction ? toGateActionResponse(run.gateAction) : null,
    outcome: run.outcome
      ? toOutcomeResponse(run.outcome, ofPublish ? (publishResultOf(run) ?? null) : null)
      : null,
  };
}

/** The engine a run's session ran on, and the one it stood in for; null for a run that kept none. */
function toStageRunEngineResponse({
  engineId,
  engineName,
  model,
  standInFor,
}: StageRun): StageRunResponse["engine"] {
  if (engineId === undefined || model === undefined) return null;
  return {
    engineId,
    engineName: engineName ?? engineId,
    model,
    standInFor: standInFor
      ? {
          engineId: standInFor.engineId,
          engineName: standInFor.engineName,
          reason: standInFor.reason,
        }
      : null,
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

function toOutcomeResponse(
  outcome: StageOutcome,
  publishResult: PublishResult | null,
): StageRunOutcomeResponse {
  const handoverNote = outcome.handoverNote ?? null;
  switch (outcome.status) {
    case "done":
      return {
        status: "done",
        summary: outcome.summary,
        skipped: outcome.skipped ?? false,
        definitionOfDoneMet: outcome.definitionOfDoneMet ? [...outcome.definitionOfDoneMet] : null,
        pullRequestUrl: outcome.pullRequestUrl ?? null,
        publishResult,
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
              standInChoice: outcome.refused.standInChoice
                ? {
                    engineId: outcome.refused.standInChoice.engineId,
                    engineName: outcome.refused.standInChoice.engineName,
                    contextTokens: outcome.refused.standInChoice.contextTokens,
                    askAbove: outcome.refused.standInChoice.askAbove,
                  }
                : null,
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
        publishResult,
        handoverNote,
      };
  }
}
