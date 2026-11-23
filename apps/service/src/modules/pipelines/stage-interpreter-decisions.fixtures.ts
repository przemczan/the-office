import { EventBus } from "../../platform/events/event-bus.js";
import { DecisionAnswered } from "../conversations/index.js";
import type { SessionScript } from "../engine/index.js";
import type { KeptOnFailure } from "./domain/routes-back.js";
import type { Stage } from "./domain/stage.js";
import { goingBackOnFailure } from "./domain/stage.fixtures.js";
import { NoRetriesLeft } from "./domain/stage-run-events.js";
import {
  A_WAITING_RESULT,
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  type PipelinesApplication,
} from "./pipelines-application.fixtures.js";
import { aCommandRun, aPerson } from "./ports/pipelines-ports.fixtures.js";
import { StageInterpreter } from "./application/stage-interpreter.js";

/** A Script Stage running the tests, going back on failure as a previous release kept it. */
export function scriptStage(key: string, onFailure?: KeptOnFailure): Stage {
  const stage: Stage = { kind: "script", key, name: key, optional: false, command: "test" };
  return onFailure ? goingBackOnFailure(stage, onFailure.goBackTo, onFailure.rounds) : stage;
}

export const draft = anAgentStage("draft");

export const agentDone = anAgentSession(aDoneResult());

export const A_WAITING = anAgentSession(A_WAITING_RESULT);

export let pipelines: PipelinesApplication;

/** The Stage Thread a DecisionAnswered tells of, as Conversations keeps it. */
export function aStageThread(taskId: string): ConstructorParameters<typeof DecisionAnswered>[0] {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    home: { kind: "task", taskId },
    roleKey: "developer",
    title: "draft · Ada",
    state: "waiting",
    session: undefined,
    override: undefined,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    runningTurnTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    startedAt: new Date(),
    openDecisions: [],
    stageThread: true,
  };
}

export async function startWith(...scripts: SessionScript[]): Promise<void> {
  pipelines = await startPipelinesApplication(scripts);
}

/** The next Script Stages' commands fail, printing these, in order. */
export function failing(...printed: string[]): void {
  pipelines.commands.commandRuns.push(
    ...printed.map((output) => [aCommandRun("npm test", "failed", output)]),
  );
}

export async function statusesOf(taskId: string): Promise<[string, string | undefined][]> {
  const runs = await runsOf(pipelines, taskId);
  return runs.map(({ stageKey, outcome }) => [stageKey, outcome?.status]);
}

/** Runs `meanwhile` as the walk moves a Task to Waiting on you, before or after the move lands. */
export function onWaiting(
  when: "before" | "after",
  meanwhile: (taskId: string) => Promise<void>,
): void {
  const { tasks } = pipelines;
  const changeState = tasks.changeState.bind(tasks);
  tasks.changeState = async (taskId, state) => {
    const waiting = state === "waiting-on-you";
    if (waiting && when === "before") await meanwhile(taskId);
    const task = await changeState(taskId, state);
    if (waiting && when === "after") await meanwhile(taskId);
    return task;
  };
}

/** Takes the first option of the Task's latest Decision, as the user's click would. */
export async function answerFirstOption(taskId: string): Promise<void> {
  const decision = pipelines.decisions.on(taskId).at(-1);
  if (!decision) throw new Error("The Decision isn't open yet.");
  await pipelines.app
    .get(StageInterpreter, { strict: false })
    .takeAnswer(taskId, decision.id, { kind: "option", option: 0 });
}

export function statesOf(taskId: string): string[] {
  return pipelines.tasks.changes
    .filter((change) => change.taskId === taskId)
    .map(({ state }) => state);
}

/** A Consultant under a key no preset has, so nothing follows the Role key itself. */
export const ARCHITECT = "architect";

/**
 * Hires Bob as the Architect, who can be consulted, holding Asked first unless `holdsAskedFirst` is
 * false.
 */
export function hireTheArchitect({ holdsAskedFirst = true } = {}): void {
  pipelines.decisions.consultants.add(ARCHITECT);
  pipelines.people.people.set(ARCHITECT, aPerson("Bob"));
  pipelines.people.titles.set(ARCHITECT, "Architect");
  if (holdsAskedFirst) pipelines.people.holders.set("asked-first-when-out-of-tries", ARCHITECT);
}

export function failuresPutTo(): (string | undefined)[] {
  const failures: (string | undefined)[] = [];
  pipelines.app.get(EventBus).subscribe(NoRetriesLeft, ({ putTo }) => {
    failures.push(putTo);
  });
  return failures;
}
