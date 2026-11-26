import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PIPELINES_OFFICE_ACTIONS, RESTART_TASK_FROM_ACTION } from "@the-office/contracts";
import type { z } from "zod";
import { officeActionTool, OfficeToolRegistry } from "../../../engine/index.js";
import { TaskRestarts } from "../../application/task-restarts.js";
import { RestartRefused } from "../../domain/restart-refused.js";
import type { HoldingUser } from "../../domain/stage-run.js";
import { SessionPeople } from "../../ports/session-people.js";
import type { RestartingPerson } from "../../ports/started-tasks.js";

type RestartTaskFrom = z.output<typeof RESTART_TASK_FROM_ACTION.input>;

/**
 * Pipelines' Office actions (the Office action convention): the one handler of each action
 * Pipelines declares, which its route (`PipelinesOfficeActionsController`) and its Office tool,
 * registered here, both call. Restart from… records who took it: the signed-in user, or the person
 * with the user who asked them and, for a call held for approval, the user who allowed it.
 */
@Injectable()
export class PipelinesOfficeActions implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly restarts: TaskRestarts,
    private readonly sessionPeople: SessionPeople,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      officeActionTool(RESTART_TASK_FROM_ACTION, async (input, { sessionId, allowedBy }) => {
        try {
          const person = await this.personInSession(sessionId, allowedBy);
          await this.restartTaskFrom(input, userBehind(person), person);
          return { text: `The Task goes on from the Stage "${input.stageKey}".`, isError: false };
        } catch (error) {
          if (error instanceof RestartRefused) return { text: error.message, isError: true };
          throw error;
        }
      }),
    );
  }

  /** The route's answer to the action, carried out for the signed-in user `by`. */
  async answer(
    action: { readonly name: string },
    input: unknown,
    by: HoldingUser,
  ): Promise<unknown> {
    if (!PIPELINES_OFFICE_ACTIONS.some(({ name }) => name === action.name)) {
      throw new Error(`Pipelines carries out no Office action ${action.name}.`);
    }
    // The route parsed the input with the action's schema.
    await this.restartTaskFrom(input as RestartTaskFrom, by);
    return {};
  }

  private restartTaskFrom(
    { taskId, ...choice }: RestartTaskFrom,
    by: HoldingUser,
    person?: RestartingPerson,
  ): Promise<void> {
    return this.restarts.restart(taskId, choice, by, person);
  }

  /** The session's person, refused when nobody keeps the session or no user asked them. */
  private async personInSession(
    sessionId: string,
    allowedBy: HoldingUser | undefined,
  ): Promise<RestartingPerson & { readonly askedBy: HoldingUser }> {
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

/** The user a person's restart is for: the one who allowed their call, else the one who asked. */
function userBehind(person: RestartingPerson & { readonly askedBy: HoldingUser }): HoldingUser {
  return person.allowedBy ?? person.askedBy;
}
