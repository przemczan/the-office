import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  PEOPLE_SETTINGS_OFFICE_ACTIONS,
  SET_DUTY_HOLDER_ACTION,
  type Duty,
  type OfficeAction,
} from "@the-office/contracts";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { Duties } from "../../application/duties.js";
import { DutyNotFound, DutyRefused } from "../../domain/duty-refused.js";
import { RoleNotFound } from "../../domain/role-not-found.js";
import { RoleRefused } from "../../domain/role-refused.js";
import { toDutyResponse } from "../http/duty-responses.js";

/**
 * People's Office actions on Office settings (the Office action convention): the one handler of
 * each action declared in PEOPLE_SETTINGS_OFFICE_ACTIONS, `set_duty_holder`, which its route
 * (`DutyOfficeActionsController`) and its Office tool, registered here, both call. Throws at start
 * for a declared action with no handler. A duty names no user, so a person's call records none.
 * The draft shows the holder now beside the one given, and fingerprints the holder now, so a
 * change of holder since the draft means the duty changed.
 */
@Injectable()
export class DutyOfficeActions implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly duties: Duties,
  ) {
    const unhandled = PEOPLE_SETTINGS_OFFICE_ACTIONS.filter(
      ({ name }) => name !== SET_DUTY_HOLDER_ACTION.name,
    );
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    const run = async ({ duty, roleKey }: DutyHolderInput): Promise<OfficeToolResult> => {
      try {
        const changed = await this.duties.change(duty, roleKey);
        return {
          text:
            changed.holder === null
              ? `${changed.label} has no holder now.`
              : `${changed.holder.name} (${changed.holder.title}) holds ${changed.label}.`,
          isError: false,
        };
      } catch (error) {
        if (
          error instanceof DutyRefused ||
          error instanceof RoleRefused ||
          error instanceof DutyNotFound ||
          error instanceof RoleNotFound
        ) {
          return { text: error.message, isError: true };
        }
        throw error;
      }
    };
    this.registry.register(
      officeActionTool(SET_DUTY_HOLDER_ACTION, run, {
        draft: async (input) => {
          const now = await this.duties.read(input.duty);
          return officeActionDraft(SET_DUTY_HOLDER_ACTION, input, {
            title: now.label,
            decidedBy: { roleKey: now.roleKey },
            values: { roleKey: now.roleKey },
          });
        },
        applyFor: run,
      }),
    );
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown): Promise<Duty> {
    if (action.name !== SET_DUTY_HOLDER_ACTION.name) {
      throw new Error(`People carries out no Office action ${action.name}.`);
    }
    const { duty, roleKey } = input as DutyHolderInput;
    return toDutyResponse(await this.duties.change(duty, roleKey));
  }
}

interface DutyHolderInput {
  readonly duty: string;
  readonly roleKey: string | null;
}
