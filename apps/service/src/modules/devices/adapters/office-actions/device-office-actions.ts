import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  DEVICE_OFFICE_ACTIONS,
  LEND_PROJECT_DEVICE_ACTION,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { ProjectDevices } from "../../application/project-devices.js";
import type { ConnectedDevice, DeviceConnector } from "../../domain/connected-device.js";
import {
  ConnectedDeviceNotFound,
  ConnectedDeviceRefused,
} from "../../domain/connected-device-refused.js";
import {
  ProjectDeviceNotFound,
  ProjectDeviceRefused,
} from "../../domain/project-device-refused.js";
import { SessionPeople } from "../../ports/session-people.js";
import { deviceResponse } from "../http/devices.controller.js";

/** What an Agent reads for a phone nobody has named, whose name is its address. */
const UNNAMED_PHONE = "an unnamed phone";

/** A device lent, and whether the Project's record still names it by its address. */
interface LentDevice {
  readonly connected: ConnectedDevice;
  readonly unnamed: boolean;
}

/**
 * The lent device as an Agent reads it: its kind, name and state, and a phone's adb serial; never
 * the Project device's own Address or Port settings.
 */
function lentWords({ connected, unnamed }: LentDevice): string {
  const { kind, name, state, endpoint } = connected;
  const serial =
    kind === "android-wireless" && endpoint !== null ? ` (adb serial ${endpoint})` : "";
  return `${unnamed ? UNNAMED_PHONE : name} (${kind}) is lent to the Task${serial}; it is ${state}.`;
}

/**
 * One of Devices' Office actions as Devices carries it out: `handle` for the user's request, an
 * Agent's call and a Proposal applied alike, its result answered to the web by `response` and
 * worded to the Agent by `words`, which never names a Project device's own address or Port.
 */
interface DeviceActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>, by: DeviceConnector): Promise<Result>;
  response(result: Result): z.input<Action["answer"]>;
  words(result: Result): string;
}

type AnyDeviceActionHandler = DeviceActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: DeviceActionHandler<Action, Result>,
): AnyDeviceActionHandler {
  return each as unknown as AnyDeviceActionHandler;
}

/**
 * Devices' Office actions (the Office action convention): the one handler of each action Devices
 * declares, which its route (`DeviceOfficeActionsController`) and its Office tool, registered here,
 * both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class DeviceOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyDeviceActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly projectDevices: ProjectDevices,
    private readonly sessionPeople: SessionPeople,
  ) {
    this.handlers = new Map([this.lendProjectDevice()].map((each) => [each.action.name, each]));
    const unhandled = DEVICE_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      this.registry.register(
        officeActionTool(
          each.action,
          (input, { sessionId, allowedBy }) =>
            this.answeredFor(input, async () =>
              each.words(await each.handle(input, await this.personIn(sessionId, allowedBy))),
            ),
          {
            draft: async (input) =>
              officeActionDraft(each.action, input, await this.snapshot(input)),
            applyFor: (input, { user }) =>
              this.answeredFor(input, async () =>
                each.words(await each.handle(input, { userId: user.userId, name: user.name })),
              ),
          },
        ),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown, by: DeviceConnector): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Devices carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never, by));
  }

  private lendProjectDevice(): AnyDeviceActionHandler {
    return handler({
      action: LEND_PROJECT_DEVICE_ACTION,
      handle: async ({ taskId, projectDeviceId }, by): Promise<LentDevice> => {
        const { device } = await this.projectDevices.read(projectDeviceId);
        return {
          connected: await this.projectDevices.lend(taskId, projectDeviceId, by),
          unnamed: device.name === device.address,
        };
      },
      response: ({ connected }: LentDevice) => deviceResponse(connected),
      words: lentWords,
    });
  }

  /** The person in the session as who connects, the user who asked them being the record's user. */
  private async personIn(
    sessionId: string,
    allowedBy?: { readonly userId: string; readonly name: string },
  ): Promise<DeviceConnector> {
    const person = await this.sessionPeople.personInSession(sessionId);
    if (person === undefined) {
      throw new ProjectDeviceRefused(["The Office doesn't know whose session this is."]);
    }
    const user = (await this.sessionPeople.askedByInSession(sessionId)) ?? allowedBy;
    return { userId: user?.userId ?? "", name: user?.name ?? person, person };
  }

  /** What a lend acts on: the device by its name, which a phone named by its address doesn't give. */
  private async snapshot(input: unknown) {
    const { projectDeviceId } = input as { projectDeviceId: string };
    const { device } = await this.projectDevices.read(projectDeviceId);
    return {
      title: device.name === device.address ? UNNAMED_PHONE : device.name,
      decidedBy: {},
      values: {},
    };
  }

  /**
   * Devices' refusals answer the Agent in words it can act on, the device's address left out of
   * them; anything else fails the call.
   */
  private async answeredFor(
    input: unknown,
    read: () => Promise<string>,
  ): Promise<OfficeToolResult> {
    try {
      return { text: await read(), isError: false };
    } catch (error) {
      if (
        error instanceof ProjectDeviceRefused ||
        error instanceof ProjectDeviceNotFound ||
        error instanceof ConnectedDeviceRefused ||
        error instanceof ConnectedDeviceNotFound
      ) {
        return { text: await this.withoutAddress(input, error.message), isError: true };
      }
      throw error;
    }
  }

  private async withoutAddress(input: unknown, words: string): Promise<string> {
    const { projectDeviceId } = input as { projectDeviceId: string };
    try {
      const { device } = await this.projectDevices.read(projectDeviceId);
      return device.address === null ? words : words.replaceAll(device.address, UNNAMED_PHONE);
    } catch {
      return words;
    }
  }
}
