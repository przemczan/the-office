import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { DecisionAnswered } from "../../conversations/index.js";
import { RoleLetGo } from "../../people/index.js";
import {
  STAFFING_OPTIONS,
  staffingDecision,
  staffingHoldReason,
} from "../domain/staffing-decision.js";
import { StageDecisions } from "../ports/stage-decisions.js";
import { StaffingHoldRepository } from "../ports/staffing-hold-repository.js";
import { StartedTasks, type ByTheUser } from "../ports/started-tasks.js";
import { TaskStagesService } from "./task-stages-service.js";

const RUNNING_STATES: readonly string[] = ["in-progress", "waiting-on-you", "paused"];

/**
 * Holds a Task whose next Stages nobody can work (spec §2.2), such as after the person who filled
 * their Role was let go: the Task is paused behind a Decision, and resumes or drops by the answer.
 * The Pipeline keeps the Stage as it was, so a Role filled again gets the Task back where it stopped.
 */
@Injectable()
export class StaffingHolds implements OnModuleInit {
  private readonly logger = new Logger(StaffingHolds.name);
  private readonly holding = new KeyedLocks();

  constructor(
    private readonly taskStages: TaskStagesService,
    private readonly tasks: StartedTasks,
    private readonly decisions: StageDecisions,
    private readonly holds: StaffingHoldRepository,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(RoleLetGo, () => this.holdTasksLackingPeople());
    this.events.subscribe(DecisionAnswered, async ({ decision }) => {
      const { answer } = decision;
      if (!answer) return;
      // A person's answer at the user's request is the user's own; a Consultant's names no user.
      const user = answer.atUsersRequest?.user ?? answer.user ?? null;
      await this.answered(decision.id, answer, { kind: "user", user });
    });
  }

  /**
   * Holds the Task when nobody can work the Stages it goes on with: paused, behind a Decision that
   * says why. True when it is held; the walk then doesn't go on.
   */
  async holdIfLackingPeople(taskId: string): Promise<boolean> {
    return this.holding.run(taskId, async () => {
      const problems = await this.taskStages.staffingProblems(taskId);
      if (problems.length === 0) return false;
      if ((await this.tasks.read(taskId)).state !== "paused") {
        await this.tasks.hold(taskId, staffingHoldReason(problems));
      }
      if (await this.holds.isHeld(taskId)) return true;
      const { id } = await this.decisions.open({
        taskId,
        threadId: undefined,
        draft: staffingDecision(problems),
      });
      await this.holds.hold(taskId, id);
      return true;
    });
  }

  private async holdTasksLackingPeople(): Promise<void> {
    for (const { id, state } of await this.tasks.list()) {
      if (!RUNNING_STATES.includes(state)) continue;
      await this.holdIfLackingPeople(id).catch((error: unknown) => {
        this.logger.error(`Task ${id} wasn't held for lack of people`, stackOf(error));
      });
    }
  }

  /**
   * The answer of the user `by`: drop the Task, or resume it, which holds it again while the lack
   * stands.
   */
  private async answered(
    decisionId: string,
    answer: { readonly kind: string; readonly option?: number },
    by: ByTheUser,
  ): Promise<void> {
    const taskId = await this.holds.release(decisionId);
    if (!taskId) return;
    const { state } = await this.tasks.read(taskId);
    if (state !== "paused") return;
    if (answer.kind === "option" && answer.option === STAFFING_OPTIONS.drop) {
      await this.tasks.drop(taskId, by);
      return;
    }
    await this.tasks.resume(taskId, by);
  }
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
