import { NO_STAGE_TOKENS, type StageRun } from "./stage-run.js";

/** A run of `implement` that ended done, as the 1st of Task `task-1`, unless `fields` say otherwise. */
export function aStageRun(fields: Partial<StageRun> = {}): StageRun {
  return {
    id: `run-${fields.number ?? 1}`,
    taskId: "task-1",
    stageKey: "implement",
    number: 1,
    carriedFailure: undefined,
    sentBack: undefined,
    threadId: undefined,
    session: undefined,
    engineId: undefined,
    engineName: undefined,
    model: undefined,
    headCommit: undefined,
    commandRuns: [],
    tokens: NO_STAGE_TOKENS,
    decisions: [],
    heldBy: undefined,
    heldByUser: undefined,
    waitingSince: undefined,
    gateAction: undefined,
    outcome: { status: "done", summary: "Done." },
    startedAt: new Date(0),
    endedAt: new Date(0),
    ...fields,
  };
}
