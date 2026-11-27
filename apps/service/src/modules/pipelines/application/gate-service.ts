import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { asFlow } from "../domain/flow.js";
import { gateActionProblems, waitingGateRun } from "../domain/gate.js";
import { GateRefused } from "../domain/gate-refused.js";
import type { TaskProgress } from "../domain/stage-progress.js";
import type { GateAction, GateDropReason, GatePerson, HoldingUser } from "../domain/stage-run.js";
import { GateContinued, GateDropped, SentBackFromGate } from "../domain/stage-run-events.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StartedTasks } from "../ports/started-tasks.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { TaskStagesService } from "./task-stages-service.js";
import { runsOfLatestStart } from "../domain/start-over.js";

/**
 * What the user does at a Gate (spec §2.3): Continue, with notes or none, Send back with feedback
 * to an earlier Agent Stage, using no round, or Drop. The action is kept on the Gate's run, which
 * the walk replays, and the walk goes on from it as it does from an answered Decision.
 */
@Injectable()
export class GateService {
  constructor(
    private readonly taskStages: TaskStagesService,
    private readonly runs: StageRunRepository,
    private readonly interpreter: StageInterpreter,
    private readonly events: EventBus,
    private readonly tasks: StartedTasks,
  ) {}

  /** Blank notes are plain Continue. */
  continue(
    taskId: string,
    byUser: HoldingUser,
    feedback?: string,
    person?: GatePerson,
  ): Promise<TaskProgress | undefined> {
    const notes = feedback?.trim();
    return this.act(taskId, {
      kind: "continue",
      ...(notes ? { feedback: notes } : {}),
      ...actors(byUser, person),
    });
  }

  sendBack(
    taskId: string,
    byUser: HoldingUser,
    stageKey: string,
    feedback: string,
    person?: GatePerson,
  ): Promise<TaskProgress | undefined> {
    return this.act(taskId, {
      kind: "send-back",
      stageKey,
      feedback: feedback.trim(),
      ...actors(byUser, person),
    });
  }

  /**
   * Drop, with the reason the user gave, if any, which the Task keeps with its move. A Duplicate
   * naming the Task itself, or a Task there is none of, is refused before the Gate's action is
   * kept, so the walk never replays a drop Work refuses.
   */
  async drop(
    taskId: string,
    byUser: HoldingUser,
    reason?: GateDropReason,
    person?: GatePerson,
  ): Promise<TaskProgress | undefined> {
    if (reason?.kind === "duplicate") {
      if (reason.taskId === taskId) {
        throw new GateRefused(["A Task can't be a duplicate of itself."]);
      }
      if (!(await this.tasks.find(reason.taskId))) {
        throw new GateRefused([`There is no Task ${reason.taskId}.`]);
      }
    }
    return this.act(taskId, {
      kind: "drop",
      ...(reason ? { reason } : {}),
      ...actors(byUser, person),
    });
  }

  /** The Task's Stages after the action; refused with the reasons when the Gate doesn't allow it. */
  private async act(taskId: string, action: GateAction): Promise<TaskProgress | undefined> {
    const runs = runsOfLatestStart(await this.runs.list(taskId));
    const stages = asFlow((await this.taskStages.find(taskId))?.stages ?? []);
    const problems = gateActionProblems(stages, runs, action);
    const gate = waitingGateRun(stages, runs);
    if (problems.length > 0 || !gate) throw new GateRefused(problems);
    if (!(await this.runs.saveGateAction(gate.id, action))) {
      throw new GateRefused(["The Gate was already passed: the Task has gone on."]);
    }
    await this.events.publish(gateEvent(taskId, gate.stageKey, action));
    await this.interpreter.goOn(taskId);
    return this.taskStages.progress(taskId);
  }
}

function gateEvent(taskId: string, gateKey: string, action: GateAction): DomainEvent {
  switch (action.kind) {
    case "continue":
      return new GateContinued(taskId, gateKey);
    case "send-back":
      return new SentBackFromGate(taskId, gateKey, action.stageKey);
    case "drop":
      return new GateDropped(taskId, gateKey);
  }
}

/** Who acted, as a Gate's action keeps them: the user, and the person who acted for them. */
function actors(
  byUser: HoldingUser,
  person: GatePerson | undefined,
): { byUser: HoldingUser; person?: GatePerson } {
  return person ? { byUser, person } : { byUser };
}
