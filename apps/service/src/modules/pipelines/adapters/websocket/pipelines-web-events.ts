import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { PipelinesWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  BudgetReached,
  DefinitionOfDoneNotMet,
  GateContinued,
  GateDropped,
  GateReached,
  NoRetriesLeft,
  PipelineCompleted,
  StageRunEnded,
  StageRunStarted,
  SentBackFromGate,
  StageSkipped,
  StopHeldAsPause,
  WentBackToStage,
} from "../../domain/stage-run-events.js";
import {
  TaskStagesEdited,
  TaskStagesMade,
  TaskStagesReset,
} from "../../domain/task-stages-events.js";

type WebEventOf<Type extends PipelinesWebEvent["type"]> = Omit<
  Extract<PipelinesWebEvent, { type: Type }>,
  "occurredAt"
>;

/**
 * The walk's events reach the web, naming the Task whose Stages changed, so an open Task page
 * refetches its Stages block.
 */
@Injectable()
export class PipelinesWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwardStageRunEvents();
    this.forwardWalkEvents();
    this.forwardGateEvents();
  }

  private forwardStageRunEvents(): void {
    this.forwarding.forward(StageRunStarted, (event): WebEventOf<"stage-run.started"> => ({
      type: "stage-run.started",
      taskId: event.taskId,
      stageKey: event.stageKey,
    }));
    this.forwarding.forward(StageRunEnded, (event): WebEventOf<"stage-run.ended"> => ({
      type: "stage-run.ended",
      taskId: event.taskId,
      stageKey: event.stageKey,
      status: event.status,
    }));
    this.forwarding.forward(
      StopHeldAsPause,
      (event): WebEventOf<"stage-run.stop-held-as-pause"> => ({
        type: "stage-run.stop-held-as-pause",
        taskId: event.taskId,
        stageKey: event.stageKey,
      }),
    );
    this.forwarding.forward(StageSkipped, (event): WebEventOf<"stage-run.skipped"> => ({
      type: "stage-run.skipped",
      taskId: event.taskId,
      stageKey: event.stageKey,
    }));
    this.forwarding.forward(WentBackToStage, (event): WebEventOf<"stage-run.went-back"> => ({
      type: "stage-run.went-back",
      taskId: event.taskId,
      fromStageKey: event.fromStageKey,
      toStageKey: event.toStageKey,
      round: event.round,
      rounds: event.rounds,
    }));
    this.forwarding.forward(BudgetReached, (event): WebEventOf<"stage-run.budget-reached"> => ({
      type: "stage-run.budget-reached",
      taskId: event.taskId,
      stageKey: event.stageKey,
      used: event.used,
      budget: event.budget,
    }));
    this.forwarding.forward(NoRetriesLeft, (event): WebEventOf<"stage-run.no-retries-left"> => ({
      type: "stage-run.no-retries-left",
      taskId: event.taskId,
      stageKey: event.stageKey,
    }));
  }

  private forwardWalkEvents(): void {
    this.forwarding.forward(TaskStagesMade, (event): WebEventOf<"task-stages.made"> => ({
      type: "task-stages.made",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskStagesEdited, (event): WebEventOf<"task-stages.edited"> => ({
      type: "task-stages.edited",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskStagesReset, (event): WebEventOf<"task-stages.reset"> => ({
      type: "task-stages.reset",
      taskId: event.taskId,
    }));
    this.forwarding.forward(
      DefinitionOfDoneNotMet,
      (event): WebEventOf<"pipeline.definition-of-done-not-met"> => ({
        type: "pipeline.definition-of-done-not-met",
        taskId: event.taskId,
      }),
    );
    this.forwarding.forward(PipelineCompleted, (event): WebEventOf<"pipeline.completed"> => ({
      type: "pipeline.completed",
      taskId: event.taskId,
    }));
  }

  private forwardGateEvents(): void {
    this.forwarding.forward(GateReached, (event): WebEventOf<"gate.reached"> => ({
      type: "gate.reached",
      taskId: event.taskId,
      stageKey: event.stageKey,
    }));
    this.forwarding.forward(GateContinued, (event): WebEventOf<"gate.continued"> => ({
      type: "gate.continued",
      taskId: event.taskId,
      stageKey: event.stageKey,
    }));
    this.forwarding.forward(SentBackFromGate, (event): WebEventOf<"gate.sent-back"> => ({
      type: "gate.sent-back",
      taskId: event.taskId,
      fromStageKey: event.fromStageKey,
      toStageKey: event.toStageKey,
    }));
    this.forwarding.forward(GateDropped, (event): WebEventOf<"gate.dropped"> => ({
      type: "gate.dropped",
      taskId: event.taskId,
      stageKey: event.stageKey,
    }));
  }
}
