import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { GATE_REACHED } from "../domain/gate.js";
import type { StageOutcome } from "../domain/stage-run.js";
import { GateReached } from "../domain/stage-run-events.js";
import type { StageRunner, StageWork } from "./stage-runner.js";
import { StageRunners } from "./stage-runners.js";

/**
 * Runs Gates (spec §2.3): the run ends as the Task reaches the Gate, and the walk then waits for
 * what the user does there, which `GateService` keeps on the run.
 */
@Injectable()
export class GateStageRunner implements StageRunner<"gate">, OnModuleInit {
  constructor(
    private readonly runners: StageRunners,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.runners.register("gate", this);
  }

  async run({ run }: StageWork<"gate">): Promise<StageOutcome> {
    await this.events.publish(new GateReached(run.taskId, run.id, run.stageKey));
    return GATE_REACHED;
  }
}
