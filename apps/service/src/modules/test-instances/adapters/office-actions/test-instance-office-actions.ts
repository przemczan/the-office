import { BadRequestException, HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  API_PATH,
  LAUNCH_INITIATIVE_TEST_INSTANCE_ACTION,
  LAUNCH_PROJECT_TEST_INSTANCE_ACTION,
  LINK_BUILT_FILE_ACTION,
  OPEN_TEST_INSTANCE_ACTION,
  SET_TEST_INSTANCE_SETTINGS_ACTION,
  STOP_TEST_INSTANCE_ACTION,
  TEST_INSTANCE_OFFICE_ACTIONS,
  type OfficeAction,
  type TestBuildFileLink,
  type TestInstanceSettings,
  type TestInstanceOpening,
} from "@the-office/contracts";
import type { z } from "zod";
import { OfficeAddresses } from "../../../../platform/http/office-addresses.js";
import type { RequestAddress } from "../../../../platform/http/local-requests.js";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { TestBuildLinks } from "../../application/test-build-links.js";
import { TestInstanceHandOffs } from "../../application/test-instance-hand-offs.js";
import { OfficePort, TestInstanceLimits } from "../../application/test-instance-limits.js";
import { OfficeHost } from "../../application/test-instance-proxy.js";
import { TestInstances, type TestInstanceOnBranch } from "../../application/test-instances.js";
import type { LaunchedBy } from "../../domain/test-instance.js";
import { TestInstanceNotFound, TestInstanceRefused } from "../../domain/test-instance-refused.js";
import { SessionPeople } from "../../ports/session-people.js";
import { WorkstationAddresses } from "../../ports/workstation-addresses.js";
import { TEST_BUILD_LINK_PATH } from "../http/test-build-files.controller.js";
import { instanceResponse } from "../http/test-instance-responses.js";
import { HAND_OFF_PATH } from "../proxy/node-http-proxy-listeners.js";
import { reachableHostnames } from "../proxy/proxy-hosts.js";

/**
 * The page a request came from, for the actions whose answer depends on the address it was opened
 * at (spec 2.12): Open's hostname and a built file's link. An Agent's call has no page.
 */
export interface RequestPage {
  /** The hostname the page was opened at, without its port. */
  readonly hostname: string;
  /** Its origin, such as `http://192.168.1.20:4390`. */
  readonly origin: string;
  readonly address: RequestAddress;
}

/**
 * One of Test instances' Office actions as Test instances carries it out: `handle` for the user's
 * request, an Agent's call and a Proposal applied alike, its result answered to the web by
 * `response` and worded to the Agent by `words`.
 */
interface TestInstanceActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  handle(input: z.output<Action["input"]>, by: LaunchedBy, page?: RequestPage): Promise<Result>;
  response(result: Result): z.input<Action["answer"]>;
  words(result: Result): string;
}

type AnyTestInstanceActionHandler = TestInstanceActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: TestInstanceActionHandler<Action, Result>,
): AnyTestInstanceActionHandler {
  return each as unknown as AnyTestInstanceActionHandler;
}

/**
 * Test instances' Office actions (the Office action convention): the one handler of each action
 * Test instances declares, which its route (`TestInstanceOfficeActionsController`) and its Office
 * tool, registered here, both call. Throws at start for a declared action with no handler.
 */
@Injectable()
export class TestInstanceOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyTestInstanceActionHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly instances: TestInstances,
    private readonly handOffs: TestInstanceHandOffs,
    private readonly links: TestBuildLinks,
    private readonly addresses: OfficeAddresses,
    private readonly officeHost: OfficeHost,
    private readonly officePort: OfficePort,
    private readonly workstation: WorkstationAddresses,
    private readonly sessionPeople: SessionPeople,
    private readonly limits: TestInstanceLimits,
  ) {
    this.handlers = new Map(
      [
        this.launchOnInitiative(),
        this.launchOnBranch(),
        this.stop(),
        this.open(),
        this.linkBuiltFile(),
        this.setSettings(),
      ].map((each) => [each.action.name, each]),
    );
    const unhandled = TEST_INSTANCE_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
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
            answered(async () =>
              each.words(await each.handle(input, await this.personIn(sessionId, allowedBy))),
            ),
          {
            draft: async (input) =>
              officeActionDraft(each.action, input, await this.snapshot(each.action, input)),
            applyFor: (input, { user }) =>
              answered(async () =>
                each.words(
                  await each.handle(input, {
                    kind: "user",
                    user: { userId: user.userId, name: user.name },
                  }),
                ),
              ),
          },
        ),
      );
    }
  }

  /** The route's answer to the action, carried out for the signed-in user at the page's address. */
  async answer(
    action: OfficeAction,
    input: unknown,
    by: LaunchedBy,
    page: RequestPage,
  ): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`Test instances carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never, by, page));
  }

  private launchOnInitiative(): AnyTestInstanceActionHandler {
    return handler({
      action: LAUNCH_INITIATIVE_TEST_INSTANCE_ACTION,
      handle: ({ initiativeId, projectId, targetKey, relayTab }, by) =>
        this.instances.launchOnInitiative(initiativeId, { projectId, targetKey, relayTab }, by),
      response: instanceResponse,
      words: launchedWords,
    });
  }

  private launchOnBranch(): AnyTestInstanceActionHandler {
    return handler({
      action: LAUNCH_PROJECT_TEST_INSTANCE_ACTION,
      handle: ({ projectId, branch, targetKey, relayTab }, by) =>
        this.instances.launchOnBranch(projectId, branch, targetKey, by, undefined, relayTab),
      response: instanceResponse,
      words: launchedWords,
    });
  }

  private stop(): AnyTestInstanceActionHandler {
    return handler({
      action: STOP_TEST_INSTANCE_ACTION,
      handle: ({ instanceId }) => this.instances.stop(instanceId),
      response: instanceResponse,
      words: (instance: TestInstanceOnBranch) =>
        `"${instance.targetName}" on ${instance.branch} is ${instance.state}.`,
    });
  }

  private open(): AnyTestInstanceActionHandler {
    return handler({
      action: OPEN_TEST_INSTANCE_ACTION,
      handle: ({ instanceId, hostname }, _by, page) => this.openAt(instanceId, hostname, page),
      response: (opening: TestInstanceOpening) => opening,
      words: ({ url }: TestInstanceOpening) =>
        `Open ${url} to sign in to the test instance. The link works once and for about 60 seconds; hand it to the user now, and keep it out of logs and files.`,
    });
  }

  private linkBuiltFile(): AnyTestInstanceActionHandler {
    return handler({
      action: LINK_BUILT_FILE_ACTION,
      handle: ({ instanceId, name }, _by, page) => this.linkTo(instanceId, name, page),
      response: (link: TestBuildFileLink) => link,
      words: (link: TestBuildFileLink) =>
        link.kind === "link"
          ? `The file downloads without signing in at ${link.url} until ${link.expiresAt}.`
          : "The Office knows no address a phone can reach: it was opened at localhost, or has no address on the local network. Ask the user to open The Office by its LAN address, then ask for the link again.",
    });
  }

  /**
   * The limits as a whole set; the contract keeps the bounds, and the range holding The Office's own
   * port is refused as 400 naming the field, from the route and in words to the Agent alike.
   */
  private setSettings(): AnyTestInstanceActionHandler {
    return handler({
      action: SET_TEST_INSTANCE_SETTINGS_ACTION,
      handle: async (settings: TestInstanceSettings) => {
        const problems = this.limits.problemsOf(settings);
        if (problems.length > 0) throw new BadRequestException(problems.join("; "));
        return this.limits.change(settings);
      },
      response: (settings: TestInstanceSettings) => settings,
      words: (settings: TestInstanceSettings) =>
        `The Test instances limits are saved: ${settings.testInstancesAtOnce} at once, ${settings.idleMinutes} idle minutes, Proxy ports ${settings.firstProxyPort} to ${settings.lastProxyPort}.`,
    });
  }

  /** A hand-off link at one of the addresses on offer, the page's own or the first when none is chosen. */
  private async openAt(
    instanceId: string,
    chosen: string | undefined,
    page: RequestPage | undefined,
  ): Promise<TestInstanceOpening> {
    const offered = reachableHostnames({
      officeHost: this.officeHost.host,
      pageHostname: page?.hostname ?? this.addresses.publicHostname,
      interfaces: this.workstation.list(),
    });
    const hostname = chosen?.toLowerCase() ?? offered[0];
    if (hostname === undefined || !offered.includes(hostname)) {
      throw new TestInstanceRefused([
        `A test instance isn't reached at ${chosen}; it is reached at ${offered.join(", ")}.`,
      ]);
    }
    const { token, port } = await this.handOffs.open(instanceId);
    return { url: `http://${hostname}:${port}${HAND_OFF_PATH}?t=${token}` };
  }

  /**
   * A link to the built file for a phone. At the page's own address; with no page, at the public
   * address, else the first address on the local network. At `localhost` or a loopback IP, which a
   * phone can't reach, or with no such address, the user is to open The Office by its LAN address.
   */
  private async linkTo(
    instanceId: string,
    name: string,
    page: RequestPage | undefined,
  ): Promise<TestBuildFileLink> {
    await this.instances.builtFile(instanceId, name);
    const origin = page === undefined ? this.originWithoutPage() : this.originOf(page);
    if (origin === undefined) return { kind: "needs-lan-address" };
    const { token, expiresAt } = await this.links.issue({ instanceId, name });
    return {
      kind: "link",
      url: `${origin}${API_PATH}/${TEST_BUILD_LINK_PATH}/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private originOf({ address, origin }: RequestPage): string | undefined {
    if (address.kind === "localhost" || address.kind === "loopback-ip") return undefined;
    return address.kind === "public" && this.addresses.publicAddress !== undefined
      ? this.addresses.publicAddress
      : origin;
  }

  /**
   * The public address, else the first network address The Office listens at (`OFFICE_HOST`'s own,
   * or with every address the workstation's, IPv4 first); none while it listens on loopback only.
   */
  private originWithoutPage(): string | undefined {
    if (this.addresses.publicAddress !== undefined) return this.addresses.publicAddress;
    const network = reachableHostnames({
      officeHost: this.officeHost.host,
      pageHostname: undefined,
      interfaces: this.workstation.list(),
    }).filter((hostname) => !isLoopback(hostname));
    const lan = network.find((hostname) => !hostname.startsWith("[")) ?? network[0];
    return lan === undefined ? undefined : `http://${lan}:${this.officePort.port}`;
  }

  /** The person in the session as the one who launches, with the user who asked and who allowed. */
  private async personIn(
    sessionId: string,
    allowedBy?: { readonly userId: string; readonly name: string },
  ): Promise<LaunchedBy> {
    const roleKey = await this.sessionPeople.personInSession(sessionId);
    if (roleKey === undefined) {
      throw new TestInstanceRefused(["The Office doesn't know whose session this is."]);
    }
    const askedBy = await this.sessionPeople.askedByInSession(sessionId);
    return {
      kind: "person",
      roleKey,
      ...(askedBy && { askedBy }),
      ...(allowedBy && { allowedBy: { userId: allowedBy.userId, name: allowedBy.name } }),
    };
  }

  /** What a call acts on: the instance, or for a launch the target it starts; nothing of it changes. */
  private async snapshot(action: OfficeAction, input: unknown) {
    if (action.name === SET_TEST_INSTANCE_SETTINGS_ACTION.name) {
      const settings = await this.limits.read();
      return {
        title: "Test instances limits",
        decidedBy: { ...settings },
        values: { ...settings },
      };
    }
    const { instanceId, targetKey } = input as { instanceId?: string; targetKey?: string };
    const title =
      instanceId === undefined
        ? (targetKey ?? "")
        : (await this.instances.read(instanceId)).targetName;
    return { title, decidedBy: {}, values: {} };
  }
}

/** A hostname only this computer reaches, such as `localhost` or `127.0.0.1`, which a phone can't. */
function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || hostname.startsWith("127.");
}

function launchedWords(instance: TestInstanceOnBranch): string {
  return `"${instance.targetName}" is launched on ${instance.branch} as the test instance ${instance.id}; it is ${instance.state}.`;
}

/** Test instances' refusals answer the Agent in words it can act on; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (
      error instanceof TestInstanceRefused ||
      error instanceof TestInstanceNotFound ||
      error instanceof HttpException
    ) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}
