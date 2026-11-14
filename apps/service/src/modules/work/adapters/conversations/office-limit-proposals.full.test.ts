import { OFFICE_WIDE_LIMIT_MAX } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { ProposalAppliers } from "../../../conversations/index.js";
import { EngineModels } from "../../../engine/index.js";
import { EngineSettingsForTests } from "../../../engine/index.fixtures.js";
import { OfficeLimits } from "../../application/office-limits.js";
import { OfficeWideLimitChanged } from "../../domain/office-limit-events.js";
import { DEFAULT_OFFICE_WIDE_LIMIT } from "../../domain/task-start.js";
import { WorkSettingsForTests } from "../../ports/work-ports.fixtures.js";
import { OfficeLimitProposals } from "./office-limit-proposals.js";
import { ANN_LEE as ANN_LEE_USER } from "../../../conversations/index.fixtures.js";

/** Conversations' registry as Work fills it as it starts, over settings of the test's own. */
function registered() {
  const appliers = new ProposalAppliers();
  const settings = new WorkSettingsForTests();
  const events = new EventBus();
  const changed: OfficeWideLimitChanged[] = [];
  events.subscribe(OfficeWideLimitChanged, (event) => {
    changed.push(event);
  });
  new OfficeLimitProposals(
    appliers,
    new OfficeLimits(settings, events, new EngineModels(new EngineSettingsForTests())),
  ).onModuleInit();
  return { appliers, settings, changed };
}

const change = (to: number) => ({ kind: "office-wide-limit", from: 3, to }) as const;

describe("Proposals of the Office-wide limit", () => {
  it("start from the limit Work keeps now", async () => {
    const { appliers } = registered();

    expect(await appliers.settingNow("office-wide-limit")).toBe(DEFAULT_OFFICE_WIDE_LIMIT);
  });

  it("are applied as Settings › Office limits changes the limit", async () => {
    const { appliers, settings, changed } = registered();

    expect(await appliers.apply(change(5), "office-manager", ANN_LEE_USER)).toEqual(change(5));

    expect(await settings.officeWideLimit()).toBe(5);
    expect(changed).toEqual([expect.objectContaining({ officeWideLimit: 5 })]);
  });

  it.each([0, OFFICE_WIDE_LIMIT_MAX + 1, 2.5])("refuse %s, as Settings does", async (to) => {
    const { appliers, settings } = registered();
    const rule = `The Office-wide limit is a whole number of running Tasks from 1 to ${OFFICE_WIDE_LIMIT_MAX}.`;

    expect(await appliers.problemsWith(change(to))).toEqual([rule]);
    await expect(appliers.apply(change(to), "office-manager", ANN_LEE_USER)).rejects.toThrow(rule);
    expect(await settings.officeWideLimit()).toBe(DEFAULT_OFFICE_WIDE_LIMIT);
  });

  it("are not drafted for the limit Work has already", async () => {
    const { appliers } = registered();

    expect(await appliers.problemsWith(change(DEFAULT_OFFICE_WIDE_LIMIT))).toEqual([
      `The Office-wide limit is ${DEFAULT_OFFICE_WIDE_LIMIT} already.`,
    ]);
  });
});
