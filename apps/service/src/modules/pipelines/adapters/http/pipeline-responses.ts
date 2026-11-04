import type {
  GateAction as GateActionResponse,
  Pipeline as PipelineResponse,
  Stage as StageResponse,
  StageProblem as StageProblemResponse,
  StageRun as StageRunResponse,
  StageRunOutcome as StageRunOutcomeResponse,
  TaskStage as TaskStageResponse,
  TaskStages as TaskStagesResponse,
} from "@the-office/contracts";
import type { Pipeline, StageProblem } from "../../domain/pipeline.js";
import type { Stage } from "../../domain/stage.js";
import type { StageProgress, TaskProgress } from "../../domain/stage-progress.js";
import type { GateAction, StageOutcome, StageRun } from "../../domain/stage-run.js";
import { latestTestResults } from "../../domain/test-results.js";

export function toPipelineResponse(pipeline: Pipeline): PipelineResponse {
  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    stages: pipeline.stages.map(toStageResponse),
  };
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
    };
  }
  const { stages, editedForTask, lockedStages, definitionOfDoneMet } = progress;
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
  };
}

function toTaskStageResponse(progress: StageProgress): TaskStageResponse {
  return {
    stage: toStageResponse(progress.stage),
    state: progress.state,
    tokens: progress.tokens,
    wentBack: progress.wentBack ?? null,
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
    threadId: run.threadId ?? null,
    session: run.session ?? null,
    tokens: run.tokens,
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
    case "drop":
      return { kind: action.kind };
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
        handoverNote,
      };
  }
}
