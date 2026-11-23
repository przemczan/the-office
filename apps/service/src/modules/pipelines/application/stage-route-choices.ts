import { Injectable } from "@nestjs/common";
import { asksAConsultantFirst } from "../domain/walk-decisions.js";
import {
  atItsLimit,
  choiceCountWords,
  choiceRowsOf,
  type ChoiceRow,
} from "../domain/route-choices.js";
import type { Stage } from "../domain/stage.js";
import type { StageRun } from "../domain/stage-run.js";
import { asFlow } from "../domain/flow.js";
import { KnownPeople } from "../ports/known-people.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageThreads } from "../ports/stage-threads.js";
import { TaskStagesRepository } from "../ports/task-stages-repository.js";

/** The Office tool an Agent chooses its Stage's route with (spec §2.3, "How an Agent chooses its route"). */
export const CHOOSE_ROUTE_TOOL = "choose_route";

/** What the Agent who chose is answered. */
export interface StageRouteChoiceAnswer {
  readonly text: string;
  readonly isError: boolean;
}

/** What the Agent asks: the route by its target's key, or `end`, and why. */
export interface AskedRouteChoice {
  readonly route: string;
  readonly reason: string;
}

const NOT_IN_A_STAGE =
  "This tool works in a running Agent Stage of a Task, and this session is in none.";
const NO_CHOICES =
  "This Stage has no routes for you to choose: The Office weighs its routes itself as it ends.";
const NO_REASON = "Give your reason for the route, in a sentence or two.";

/**
 * An Agent's choice of the route its Stage leaves by (spec §2.3, "How an Agent chooses its
 * route"): only one of the Stage's choice rows, kept on the running run with its reason, the last
 * choice counting. The walk follows it only as the Stage ends done; a route at its limit is still
 * accepted, the answer saying the walk will stop there and who it asks.
 */
@Injectable()
export class StageRouteChoices {
  constructor(
    private readonly threads: StageThreads,
    private readonly runs: StageRunRepository,
    private readonly taskStages: TaskStagesRepository,
    private readonly people: KnownPeople,
  ) {}

  async inSession(sessionId: string, asked: AskedRouteChoice): Promise<StageRouteChoiceAnswer> {
    const taskId = await this.threads.taskInSession(sessionId);
    const runs = taskId === undefined ? [] : await this.runs.list(taskId);
    const run = runs.findLast(({ outcome }) => outcome === undefined);
    if (!run) return refused(NOT_IN_A_STAGE);
    const stages = asFlow((await this.taskStages.find(run.taskId))?.stages ?? []);
    const stage = stages.find(({ key }) => key === run.stageKey);
    if (stage?.kind !== "agent") return refused(NOT_IN_A_STAGE);
    const choices = choiceRowsOf(stage.key, stages, runs);
    if (choices.length === 0) return refused(NO_CHOICES);
    const route = asked.route.trim();
    const chosen = choices.find(({ key }) => key === route);
    if (!chosen) return refused(notAChoice(route, choices));
    const reason = asked.reason.trim();
    if (reason === "") return refused(NO_REASON);
    await this.runs.saveRouteChoice(run.id, { to: chosen.route.to, reason });
    const limitWords = atItsLimit(chosen.count) ? ` ${await this.ranOut(stage, chosen, runs)}` : "";
    return { text: `Chose ${chosen.targetName}: ${reason}${limitWords}`, isError: false };
  }

  /**
   * What happens to a route chosen at its limit (spec §2.3, "When a limit runs out"): the walk stops
   * before following it and asks whoever is asked first, else the user.
   */
  private async ranOut(
    stage: Stage,
    chosen: ChoiceRow,
    runs: readonly StageRun[],
  ): Promise<string> {
    const { times, limit } = chosen.count;
    const consultantFirst = asksAConsultantFirst(
      {
        kind: "route-limit",
        stage,
        atLimit: { route: chosen.route, times, limit: limit ?? times, back: false },
        others: [],
        note: undefined,
      },
      runs,
    );
    const roleKey = consultantFirst
      ? await this.people.holderOf("asked-first-when-out-of-tries")
      : undefined;
    const who =
      roleKey === undefined ? "the user" : `${await this.named(roleKey)} first, then the user`;
    return `Its limit ran out (${choiceCountWords(chosen.count)}): as this Stage ends done, the walk stops before following it and asks ${who} whether to follow it once more.`;
  }

  /** A Role's holder by name and title, or the title alone while nobody fills it. */
  private async named(roleKey: string): Promise<string> {
    const title = this.people.roleTitle(roleKey);
    const name = (await this.people.find(roleKey))?.card.name;
    return name ? `${name} (${title})` : `the ${title}`;
  }
}

function refused(text: string): StageRouteChoiceAnswer {
  return { text, isError: true };
}

/** The refusal of a route that isn't one of the Stage's choice rows, naming those it may choose. */
function notAChoice(route: string, choices: readonly ChoiceRow[]): string {
  const may = choices.map(({ key, words }) => `${key} ("${words}")`).join(", ");
  return `"${route}" isn't one of this Stage's choices: The Office weighs its other routes itself. Choose one of these by its key: ${may}.`;
}
