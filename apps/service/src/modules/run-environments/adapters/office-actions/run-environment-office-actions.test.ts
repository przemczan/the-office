import { SET_RUN_ENVIRONMENT_LIMITS_ACTION } from "@the-office/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import { HostCores } from "../../application/host-cores.js";
import { RunEnvironmentOfficeLimits } from "../../application/run-environment-office-limits.js";
import { RunEnvironmentSlots } from "../../application/run-environment-slots.js";
import { RunEnvironmentSettingsForTests } from "../../ports/run-environment-settings.fixtures.js";
import { RunEnvironmentOfficeActions } from "./run-environment-office-actions.js";

const HOST_CORES = 10;
const USER = { userId: "user-ann", name: "Ann Lee" };
const CHANGED = {
  runEnvironmentsAtOnce: 3,
  cpuLimit: "fixed" as const,
  fixedCpus: 6,
  memoryMegabytes: 8192,
  processes: 2048,
};

let settings: RunEnvironmentSettingsForTests;
let registry: OfficeToolRegistry;
let tool: OfficeTool;

beforeEach(() => {
  settings = new RunEnvironmentSettingsForTests();
  registry = new OfficeToolRegistry();
  const limits = new RunEnvironmentOfficeLimits(
    settings,
    new RunEnvironmentSlots(settings),
    new HostCores(HOST_CORES),
    new EventBus(),
  );
  new RunEnvironmentOfficeActions(registry, limits).onModuleInit();
  const [found] = registry.named([SET_RUN_ENVIRONMENT_LIMITS_ACTION.name], RUN_EVERY_CALL);
  if (!found) throw new Error("set_run_environment_limits is not registered.");
  tool = found;
});

describe("set_run_environment_limits", () => {
  it("is a tool in the group of its declaration", () => {
    expect(tool.authority?.group).toBe(SET_RUN_ENVIRONMENT_LIMITS_ACTION.group);
  });

  it("saves the limits for a person, in words", async () => {
    const result = await tool.run(tool.input.parse(CHANGED), anOfficeToolCall("session-1"));

    expect(result.isError).toBe(false);
    expect(result.text).toContain("3 at once");
    expect(await settings.read()).toMatchObject({
      runEnvironmentsAtOnce: 3,
      limits: { cpuLimit: { choice: "fixed", fixedCpus: 6 }, memoryMegabytes: 8192 },
    });
  });

  it("answers fixed CPUs above this computer's cores in words and saves nothing", async () => {
    const before = await settings.read();

    const result = await tool.run(
      tool.input.parse({ ...CHANGED, fixedCpus: HOST_CORES + 1 }),
      anOfficeToolCall("session-1"),
    );

    expect(result.isError).toBe(true);
    expect(result.text).toContain("fixedCpus:");
    expect(await settings.read()).toEqual(before);
  });

  it("drafts the limits beside those in force, applies them for the user and then reads stale", async () => {
    const draft = await tool.draft?.(tool.input.parse(CHANGED));

    expect(draft?.subject).toMatchObject({ kind: "office-setting", id: "run-environments" });
    expect(draft?.subject.title).toBe("Run environments limits");
    expect(draft?.fields.find(({ label }) => label === "Memory megabytes")).toMatchObject({
      before: "4096",
      after: "8192",
    });
    const applied = await tool.applyFor?.(tool.input.parse(CHANGED), {
      user: USER,
      proposedBy: "developer",
    });
    expect(applied?.isError).toBe(false);
    const after = await tool.draft?.(tool.input.parse(CHANGED));
    expect(after?.fingerprint).not.toEqual(draft?.fingerprint);
  });
});
