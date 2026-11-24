import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import { DecisionAnswered, stageAnswerOf } from "../../conversations/index.js";
import { DutyHolderChanged, RoleLetGo } from "../../people/index.js";
import {
  STAFFING_OPTIONS,
  staffingDecision,
  staffingHoldReason,
} from "../domain/staffing-decision.js";
import { StageDecisions } from "../ports/stage-decisions.js";
import { StaffingHoldRepository } from "../ports/staffing-hold-repository.js";
import { StartedTasks, type ResumedOrDroppedBy } from "../ports/started-tasks.js";
import { TaskStagesService } from "./task-stages-service.js";

/**
 * Holds a Task whose next Stages nobody can work (spec §2.2), such as after the person who filled
 * their Role was let go, or the duty they name was left unheld: the Task is paused behind a
 * Decision, and resumes or drops by the answer.
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
    // A Stage naming the duty goes to its new holder, or to nobody (spec §2.3).
    this.events.subscribe(DutyHolderChanged, () => this.holdTasksLackingPeople());
    this.events.subscribe(DecisionAnswered, async ({ decision }) => {
      const { answer } = decision;
      const given = stageAnswerOf(decision);
      if (!answer || !given) return;
      await this.answered(decision.id, given, answeredBy(answer));
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
    for (const { id } of await this.tasks.started()) {
      await this.holdIfLackingPeople(id).catch((error: unknown) => {
        this.logger.error(`Task ${id} wasn't held for lack of people`, stackOf(error));
      });
    }
  }

  /**
   * The answer, given `by` a user or a Consultant: drop the Task, or resume it, which holds it again
   * while the lack stands. The Drop goes before the hold is let go, so a refused one leaves the Task
   * held behind the Decision; a Resume goes after, so the lack can hold it again.
   */
  private async answered(
    decisionId: string,
    answer: { readonly kind: string; readonly option?: number },
    by: ResumedOrDroppedBy,
  ): Promise<void> {
    const taskId = await this.holds.taskHeldBy(decisionId);
    if (!taskId) return;
    const paused = (await this.tasks.read(taskId)).state === "paused";
    const drops = answer.kind === "option" && answer.option === STAFFING_OPTIONS.drop;
    if (paused && drops) await this.tasks.dropAsAnswered(taskId, { decisionId, by });
    if (!(await this.holds.release(decisionId))) return;
    if (paused && !drops) await this.tasks.resume(taskId, by);
  }
}

/**
 * Who the answer's Resume or Drop is recorded by: the Consultant who gave it, or else the user, as a
 * person's answer at the user's request is the user's own.
 */
function answeredBy(
  answer: NonNullable<DecisionAnswered["decision"]["answer"]>,
): ResumedOrDroppedBy {
  if (answer.answeredBy !== undefined) return { kind: "person", roleKey: answer.answeredBy };
  return { kind: "user", user: answer.atUsersRequest?.user ?? answer.user ?? null };
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
