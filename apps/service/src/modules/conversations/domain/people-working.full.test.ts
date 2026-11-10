import { describe, expect, it } from "vitest";
import { aDecision } from "./decision.fixtures.js";
import { peopleWorkingOnTasks } from "./people-working.js";
import type { Thread } from "./thread.js";
import { aThread } from "./thread.fixtures.js";

const TASK = "3b1f6f0e-2a4d-4c8e-9f1a-7d2e5c6b8a90";
const OTHER_TASK = "7c2e1d4a-5b3f-4e6a-8d9c-0a1b2c3d4e5f";
const FIRST = new Date("2026-11-05T09:00:00.000Z");
const LATER = new Date("2026-11-05T10:00:00.000Z");

function answeringOn(taskId: string, roleKey: string, fields: Partial<Thread> = {}): Thread {
  return aThread({
    id: crypto.randomUUID(),
    home: { kind: "task", taskId },
    roleKey,
    state: "answering",
    ...fields,
  });
}

describe("the people working on Tasks", () => {
  it("counts a Stage Thread, a person's own Thread and a Consultation", () => {
    const consultation = { decisionId: "asked", askerThreadId: "stage", askerRoleKey: "oscar" };

    const working = peopleWorkingOnTasks([
      answeringOn(TASK, "oscar", { stageThread: true, startedAt: FIRST }),
      answeringOn(TASK, "planner", { startedAt: FIRST }),
      answeringOn(TASK, "cto", { consultation, startedAt: LATER }),
    ]);

    expect(working).toEqual([{ taskId: TASK, roleKeys: ["oscar", "planner", "cto"] }]);
  });

  it("leads with whoever started first, as the order Threads are read in can change", () => {
    const working = peopleWorkingOnTasks([
      answeringOn(TASK, "rui", { startedAt: LATER }),
      answeringOn(TASK, "oscar", { startedAt: FIRST }),
    ]);

    expect(working).toEqual([{ taskId: TASK, roleKeys: ["oscar", "rui"] }]);
  });

  it("shows a person with two Threads on the Task once", () => {
    const working = peopleWorkingOnTasks([
      answeringOn(TASK, "oscar", { stageThread: true }),
      answeringOn(TASK, "oscar"),
    ]);

    expect(working).toEqual([{ taskId: TASK, roleKeys: ["oscar"] }]);
  });

  it("gives each Task its own people", () => {
    const working = peopleWorkingOnTasks([
      answeringOn(TASK, "oscar"),
      answeringOn(OTHER_TASK, "oscar"),
      answeringOn(OTHER_TASK, "rui"),
    ]);

    expect(working).toEqual([
      { taskId: TASK, roleKeys: ["oscar"] },
      { taskId: OTHER_TASK, roleKeys: ["oscar", "rui"] },
    ]);
  });

  it("leaves out a Thread waiting on an open Decision, while its Consultant shows", () => {
    const decision = aDecision({ putTo: "cto" });
    const consultation = {
      decisionId: decision.id,
      askerThreadId: "stage",
      askerRoleKey: "oscar",
    };

    const working = peopleWorkingOnTasks([
      answeringOn(TASK, "oscar", { stageThread: true, openDecision: decision }),
      answeringOn(TASK, "cto", { consultation }),
    ]);

    expect(working).toEqual([{ taskId: TASK, roleKeys: ["cto"] }]);
  });

  it("leaves out a Thread that isn't answering", () => {
    expect(peopleWorkingOnTasks([answeringOn(TASK, "oscar", { state: "waiting" })])).toEqual([]);
  });

  it("leaves out Threads in a chat and on an Initiative", () => {
    const working = peopleWorkingOnTasks([
      aThread({ state: "answering" }),
      aThread({ state: "answering", home: { kind: "initiative", initiativeId: TASK } }),
    ]);

    expect(working).toEqual([]);
  });
});
