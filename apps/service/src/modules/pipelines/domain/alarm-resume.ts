import { nextMove } from "./pipeline-walk.js";
import { type AgentStage, isPublishStage, type Stage } from "./stage.js";
import type { StageRun } from "./stage-run.js";

/**
 * How a Task the fire alarm paused goes on at the all clear (spec §2.8), through the Context policy
 * (spec §2.5): its Agent Stage continues its session with the cache warm, continues it and
 * re-caches its context, or starts fresh with a Brief and the Handover note; a Script Stage runs
 * its script again; a Publish the alarm let finish is recorded; a Task waiting on the user waits
 * again; anything else goes on with no model call before it.
 */
export type ResumeKind =
  | "continues-warm"
  | "re-caches"
  | "fresh"
  | "script"
  | "publish-finished"
  | "waits-on-you"
  | "goes-on";

/** How the Task goes on, with what it costs before its work continues. */
export interface TaskResume {
  readonly kind: ResumeKind;
  /** The Stage it goes on with; undefined when it has none ahead. */
  readonly stageName: string | undefined;
  /** The context it continues: read from the cache, or re-cached. 0 for any other kind. */
  readonly contextTokens: number;
  /** The Brief a fresh session starts with. 0 for any other kind. */
  readonly briefTokens: number;
  /** What resuming costs, in tokens, before work continues. */
  readonly tokens: number;
}

/** What the walk does first once the Task resumes, before any session is asked about. */
export type WalkAhead =
  /** The Stage the alarm held is still running, until its safe point. */
  | { readonly kind: "stopping" }
  | { readonly kind: "agent"; readonly stage: AgentStage }
  | { readonly kind: "script"; readonly stage: Stage }
  | { readonly kind: "publish-finished"; readonly stage: Stage }
  | { readonly kind: "waits-on-you" }
  | { readonly kind: "goes-on"; readonly stage: Stage | undefined };

/** What the Agent Stage ahead's session would be, from the Context policy. */
export interface SessionAhead {
  readonly move: "resume" | "fresh" | "hand-off";
  readonly cacheWarm: boolean;
  readonly contextTokens: number;
  readonly briefTokens: number;
}

/**
 * A warm cache is read at a tenth of the price of the context it holds, so continuing warm counts
 * a tenth of it, as the click-through counts it.
 */
const CACHE_READ_SHARE = 0.1;

/** What the walk does first once the Task resumes, from its Stages, walked, and runs. */
export function walkAhead(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  definitionOfDone: readonly string[],
): WalkAhead {
  const last = runs.at(-1);
  if (last && !last.outcome) return { kind: "stopping" };
  const lastStage = last && stages.find(({ key }) => key === last.stageKey);
  if (isPublishStage(lastStage) && last?.outcome?.status === "done") {
    return { kind: "publish-finished", stage: lastStage };
  }
  const move = nextMove(stages, runs, definitionOfDone);
  switch (move.move) {
    case "wait":
    case "ask":
      return { kind: "waits-on-you" };
    case "complete":
    case "drop":
      return { kind: "goes-on", stage: undefined };
    case "skip":
      return { kind: "goes-on", stage: move.stage };
    case "run":
      return runAhead(move.stage);
  }
}

function runAhead(stage: Stage): WalkAhead {
  switch (stage.kind) {
    case "agent":
      return { kind: "agent", stage };
    case "script":
      return { kind: "script", stage };
    case "gate":
      return { kind: "waits-on-you" };
  }
}

/**
 * How the Task resumes, with its cost: for an Agent Stage, from what the Context policy would do
 * with its session, undefined when nobody fills its Role. Undefined while the Stage the alarm
 * holds is still stopping.
 */
export function taskResumeOf(
  ahead: WalkAhead,
  session: SessionAhead | undefined,
): TaskResume | undefined {
  switch (ahead.kind) {
    case "stopping":
      return undefined;
    case "agent":
      // Nobody fills its Role: the Task is put to the user as it resumes.
      return session ? agentResume(ahead.stage, session) : noModelCall("waits-on-you", undefined);
    case "script":
    case "publish-finished":
      return noModelCall(ahead.kind, ahead.stage.name);
    case "waits-on-you":
      return noModelCall("waits-on-you", undefined);
    case "goes-on":
      return noModelCall("goes-on", ahead.stage?.name);
  }
}

function agentResume(stage: AgentStage, session: SessionAhead): TaskResume {
  const { contextTokens, briefTokens } = session;
  if (session.move !== "resume") {
    return {
      kind: "fresh",
      stageName: stage.name,
      contextTokens: 0,
      briefTokens,
      tokens: briefTokens,
    };
  }
  return session.cacheWarm
    ? {
        kind: "continues-warm",
        stageName: stage.name,
        contextTokens,
        briefTokens: 0,
        tokens: Math.round(contextTokens * CACHE_READ_SHARE),
      }
    : {
        kind: "re-caches",
        stageName: stage.name,
        contextTokens,
        briefTokens: 0,
        tokens: contextTokens,
      };
}

function noModelCall(kind: ResumeKind, stageName: string | undefined): TaskResume {
  return { kind, stageName, contextTokens: 0, briefTokens: 0, tokens: 0 };
}
