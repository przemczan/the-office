import type {
  Pipeline as PipelineResponse,
  Stage as StageResponse,
  StageRun as StageRunResponse,
  StageRunOutcome as StageRunOutcomeResponse,
  TaskStage as TaskStageResponse,
} from "@the-office/contracts";
import type { Pipeline } from "../../domain/pipeline.js";
import type { Stage } from "../../domain/stage.js";
import type { StageProgress } from "../../domain/stage-progress.js";
import type { StageOutcome, StageRun } from "../../domain/stage-run.js";

export function toPipelineResponse(pipeline: Pipeline): PipelineResponse {
  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    stages: pipeline.stages.map(toStageResponse),
  };
}

export function toTaskStageResponse(progress: StageProgress): TaskStageResponse {
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
        onFailure: stage.onFailure,
      };
    case "script":
      return { kind: "script", ...fields, command: stage.command, onFailure: stage.onFailure };
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
    commandRuns: run.commandRuns.map(({ purpose, commandLine, outcome, durationMs }) => ({
      purpose,
      commandLine,
      outcome,
      durationMs,
    })),
    outcome: run.outcome ? toOutcomeResponse(run.outcome) : null,
  };
}

function toOutcomeResponse(outcome: StageOutcome): StageRunOutcomeResponse {
  const handoverNote = outcome.handoverNote ?? null;
  switch (outcome.status) {
    case "done":
      return {
        status: "done",
        summary: outcome.summary,
        skipped: outcome.skipped ?? false,
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
