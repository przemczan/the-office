import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../../platform/events/event-bus.js";
import {
  TestInstanceCommitRecorded,
  TestInstances,
  TestInstanceStateChanged,
  type TestInstance,
} from "../../../test-instances/index.js";
import type { ActionRunUser } from "../../domain/action-run.js";
import { ActionRunNotFound, ActionRunRefused } from "../../domain/action-run-refused.js";
import {
  ActionTestInstances,
  type RunTestInstance,
  type TestInstanceMove,
} from "../../ports/action-test-instances.js";

/** Test instances' launch, run as the Action, its stop, its log and its moves. */
@Injectable()
export class TestInstancesActionRuns extends ActionTestInstances {
  constructor(
    private readonly instances: TestInstances,
    private readonly events: EventBus,
  ) {
    super();
  }

  async launch(
    projectId: string,
    branch: string,
    targetKey: string,
    by: ActionRunUser,
    runAs: { readonly actionKey: string; readonly actionName: string },
  ): Promise<RunTestInstance> {
    const instance = await translated(() =>
      this.instances.launchOnBranch(
        projectId,
        branch,
        targetKey,
        { kind: "user", user: by },
        runAs,
      ),
    );
    return runInstanceOf(instance);
  }

  async read(id: string): Promise<RunTestInstance> {
    return runInstanceOf(await translated(() => this.instances.read(id)));
  }

  async stop(id: string): Promise<RunTestInstance> {
    return runInstanceOf(await translated(() => this.instances.stop(id)));
  }

  onMoved(listener: (move: TestInstanceMove) => void): void {
    this.events.subscribe(
      TestInstanceStateChanged,
      ({ instanceId, to, failedReason, stoppedBy }) => {
        listener({ instanceId, to, failedReason, stoppedByUser: stoppedBy === "by-user" });
      },
    );
    this.events.subscribe(TestInstanceCommitRecorded, ({ instanceId, commit }) => {
      listener({ instanceId, commit });
    });
  }

  async readLog(id: string, from: number): Promise<{ text: string; nextOffset: number }> {
    const { text, nextOffset } = await translated(() => this.instances.readLog(id, from));
    return { text, nextOffset };
  }
}

function runInstanceOf(instance: TestInstance): RunTestInstance {
  return {
    id: instance.id,
    state: instance.state,
    commit: instance.commit,
    failedReason: instance.failedReason,
  };
}

/**
 * Test instances' refusals, which its entry doesn't export, by their shape: one with reasons is a
 * refusal in its words, one not found is ActionRunNotFound.
 */
async function translated<Answer>(asked: () => Promise<Answer>): Promise<Answer> {
  try {
    return await asked();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const { reasons } = error as Error & { reasons?: unknown };
    if (Array.isArray(reasons)) {
      throw new ActionRunRefused(reasons.filter((each) => typeof each === "string"));
    }
    if (error.name === "TestInstanceNotFound") throw new ActionRunNotFound(error.message);
    throw error;
  }
}
