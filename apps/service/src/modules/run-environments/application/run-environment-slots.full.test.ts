import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RUN_ENVIRONMENT_OPTIONS } from "../domain/run-environment.js";
import { RunEnvironmentSettingsForTests } from "../ports/run-environment-settings.fixtures.js";
import { RunEnvironmentSlots } from "./run-environment-slots.js";

let settings: RunEnvironmentSettingsForTests;
let slots: RunEnvironmentSlots;

function atOnce(runEnvironmentsAtOnce: number): Promise<void> {
  return settings.change({ ...DEFAULT_RUN_ENVIRONMENT_OPTIONS, runEnvironmentsAtOnce });
}

/** Takes a slot for the Task, telling whether it had to wait. */
function take(taskId: string): { taken: Promise<void>; waited: () => boolean } {
  const onWaiting = vi.fn<() => void>();
  return { taken: slots.take(taskId, onWaiting), waited: () => onWaiting.mock.calls.length > 0 };
}

beforeEach(async () => {
  settings = new RunEnvironmentSettingsForTests();
  slots = new RunEnvironmentSlots(settings);
  await atOnce(1);
});

describe("RunEnvironmentSlots, as Settings changes Run environments at once", () => {
  it("lets the waiting take a slot at once when the limit is raised, first come first served", async () => {
    await take("task-1").taken;
    const second = take("task-2");
    const third = take("task-3");
    await vi.waitFor(() => expect(third.waited()).toBe(true));

    await atOnce(2);
    await slots.admitWaiting();

    await second.taken;
    expect(slots.holds("task-2")).toBe(true);
    expect(slots.holds("task-3")).toBe(false);
  });

  it("takes no slot away when the limit is lowered; new ones wait until fewer hold one", async () => {
    await atOnce(2);
    await take("task-1").taken;
    await take("task-2").taken;

    await atOnce(1);
    await slots.admitWaiting();
    const third = take("task-3");
    await vi.waitFor(() => expect(third.waited()).toBe(true));

    expect(slots.holds("task-1")).toBe(true);
    expect(slots.holds("task-2")).toBe(true);
    await slots.release("task-1");
    expect(slots.holds("task-3")).toBe(false);
    await slots.release("task-2");
    await third.taken;
    expect(slots.holds("task-3")).toBe(true);
  });
});
