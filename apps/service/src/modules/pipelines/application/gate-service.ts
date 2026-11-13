import { walkedStages } from "../domain/resolve-stages.js";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { gateActionProblems, waitingGateRun } from "../domain/gate.js";
import { GateRefused } from "../domain/gate-refused.js";
import type { TaskProgress } from "../domain/stage-progress.js";
import type { GateAction } from "../domain/stage-run.js";
import { GateContinued, GateDropped, SentBackFromGate } from "../domain/stage-run-events.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import { StageInterpreter } from "./stage-interpreter.js";
import { TaskStagesService } from "./task-stages-service.js";

/**
 * What the user does at a Gate (spec §2.3): Continue, with notes or none, Send back with feedback to an earlier Agent
 * Stage, using no round, or Drop. The action is kept on the Gate's run, which the walk replays, and
 * the walk goes on from it as it does from an answered Decision.
 */
@Injectable()
export class GateService {
  constructor(
    private readonly taskStages: TaskStagesService,
    private readonly runs: StageRunRepository,
    private readonly interpreter: StageInterpreter,
    private readonly events: EventBus,
  ) {}

  /** Blank notes are plain Continue. */
  continue(taskId: string, feedback?: string): Promise<TaskProgress | undefined> {
    const notes = feedback?.trim();
    return this.act(taskId, notes ? { kind: "continue", feedback: notes } : { kind: "continue" });
  }

  sendBack(taskId: string, stageKey: string, feedback: string): Promise<TaskProgress | undefined> {
    return this.act(taskId, { kind: "send-back", stageKey, feedback: feedback.trim() });
  }

  drop(taskId: string): Promise<TaskProgress | undefined> {
    return this.act(taskId, { kind: "drop" });
  }

  /** The Task's Stages after the action; refused with the reasons when the Gate doesn't allow it. */
  private async act(taskId: string, action: GateAction): Promise<TaskProgress | undefined> {
    const runs = await this.runs.list(taskId);
    const stages = walkedStages((await this.taskStages.find(taskId))?.stages ?? [], runs);
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
