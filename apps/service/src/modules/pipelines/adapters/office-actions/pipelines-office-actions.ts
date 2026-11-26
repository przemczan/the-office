import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  EDIT_TASK_STAGES_ACTION,
  PIPELINES_OFFICE_ACTIONS,
  RESTART_TASK_FROM_ACTION,
  SWITCH_TO_STAND_IN_ACTION,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import { officeActionTool, OfficeToolRegistry } from "../../../engine/index.js";
import { StandInSwitches } from "../../application/stand-in-switches.js";
import { TaskRestarts } from "../../application/task-restarts.js";
import { TaskStagesService } from "../../application/task-stages-service.js";
import { withGivenLimits } from "../../domain/flow.js";
import { RestartRefused } from "../../domain/restart-refused.js";
import type { HoldingUser } from "../../domain/stage-run.js";
import { StagesEditRefused } from "../../domain/stages-edit-refused.js";
import { SessionPeople } from "../../ports/session-people.js";
import type { RestartingPerson } from "../../ports/started-tasks.js";
import { toTaskStagesResponse } from "../http/pipeline-responses.js";

type RestartTaskFrom = z.output<typeof RESTART_TASK_FROM_ACTION.input>;
type EditTaskStages = z.output<typeof EDIT_TASK_STAGES_ACTION.input>;
type SwitchToStandIn = z.output<typeof SWITCH_TO_STAND_IN_ACTION.input>;

/** The person in a session, with the user who asked them and, for a held call, who allowed it. */
type PersonInSession = RestartingPerson & { readonly askedBy: HoldingUser };

/**
 * Pipelines' Office actions (the Office action convention): the one handler of each action
 * Pipelines declares, which its route (`PipelinesOfficeActionsController`) and its Office tool,
 * registered here, both call. What a person's call records is the person with the user who asked
 * them and, for a call held for approval, the user who allowed it.
 */
@Injectable()
export class PipelinesOfficeActions implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly restarts: TaskRestarts,
    private readonly taskStages: TaskStagesService,
    private readonly standInSwitches: StandInSwitches,
    private readonly sessionPeople: SessionPeople,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      officeActionTool(RESTART_TASK_FROM_ACTION, (input, { sessionId, allowedBy }) =>
        this.answered(async () => {
          const person = await this.personInSession(sessionId, allowedBy);
          await this.restartTaskFrom(input, userBehind(person), person);
          return `The Task goes on from the Stage "${input.stageKey}".`;
        }),
      ),
    );
    this.registry.register(
      officeActionTool(EDIT_TASK_STAGES_ACTION, (input) =>
        this.answered(async () => {
          await this.editTaskStages(input);
          return "The Task's Stages are as given now.";
        }),
      ),
    );
    this.registry.register(
      officeActionTool(SWITCH_TO_STAND_IN_ACTION, (input, { sessionId, allowedBy }) =>
        this.answered(async () => {
          const person = await this.personInSession(sessionId, allowedBy);
          const { results } = await this.switchToStandIn(input, userBehind(person));
          return results.map(({ words }) => words).join("\n");
        }),
      ),
    );
  }

  /** The route's answer to the action, carried out for the signed-in user `by`. */
  async answer(action: OfficeAction, input: unknown, by: HoldingUser): Promise<unknown> {
    if (!PIPELINES_OFFICE_ACTIONS.some(({ name }) => name === action.name)) {
      throw new Error(`Pipelines carries out no Office action ${action.name}.`);
    }
    // The route parsed the input with the action's schema.
    switch (action.name) {
      case RESTART_TASK_FROM_ACTION.name:
        await this.restartTaskFrom(input as RestartTaskFrom, by);
        return {};
      case EDIT_TASK_STAGES_ACTION.name:
        return await this.editTaskStages(input as EditTaskStages);
      default:
        return await this.switchToStandIn(input as SwitchToStandIn, by);
    }
  }

  private restartTaskFrom(
    { taskId, ...choice }: RestartTaskFrom,
    by: HoldingUser,
    person?: RestartingPerson,
  ): Promise<void> {
    return this.restarts.restart(taskId, choice, by, person);
  }

  private async editTaskStages({ taskId, stages, endPosition }: EditTaskStages) {
    return toTaskStagesResponse(
      await this.taskStages.edit(taskId, withGivenLimits(stages), endPosition),
    );
  }

  private async switchToStandIn({ runIds }: SwitchToStandIn, by: HoldingUser) {
    return { results: await this.standInSwitches.switch(runIds, by) };
  }

  /** Pipelines' refusals answer the Agent in words it can act on; anything else fails the call. */
  private async answered(
    run: () => Promise<string>,
  ): Promise<{ readonly text: string; readonly isError: boolean }> {
    try {
      return { text: await run(), isError: false };
    } catch (error) {
      if (error instanceof RestartRefused || error instanceof StagesEditRefused) {
        return { text: error.message, isError: true };
      }
      throw error;
    }
  }

  /** The session's person, refused when nobody keeps the session or no user asked them. */
  private async personInSession(
    sessionId: string,
    allowedBy: HoldingUser | undefined,
  ): Promise<PersonInSession> {
    const roleKey = await this.sessionPeople.personInSession(sessionId);
    if (roleKey === undefined) {
      throw new RestartRefused(["The Office doesn't know whose session this is."]);
    }
    const asked = await this.sessionPeople.askedByInSession(sessionId);
    if (!asked) throw new RestartRefused(["The Office doesn't know which user asked for this."]);
    return {
      kind: "person",
      roleKey,
      askedBy: { userId: asked.userId, name: asked.name },
      ...(allowedBy && { allowedBy: { userId: allowedBy.userId, name: allowedBy.name } }),
    };
  }
}

/** The user a person's call is for: the one who allowed it, else the one who asked. */
function userBehind(person: PersonInSession): HoldingUser {
  return person.allowedBy ?? person.askedBy;
}
