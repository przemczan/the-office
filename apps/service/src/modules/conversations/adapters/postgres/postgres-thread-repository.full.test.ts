import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Thread } from "../../domain/thread.js";
import { openDecision, renameThread } from "../../domain/thread-changes.js";
import { aThread } from "../../domain/thread.fixtures.js";
import { ThreadNotFound } from "../../domain/thread-not-found.js";
import {
  repository,
  aThreadOfItsOwn,
  AT,
  setUpEachTest,
} from "./postgres-thread-repository.fixtures.js";

setUpEachTest();

describe("PostgresThreadRepository", () => {
  it("lists the person's Threads on every Task, the newest first, and not their chat's", async () => {
    const roleKey = `role-${randomUUID()}`;
    const onTask = (taskId: string, startedAt: string): Thread =>
      aThread({
        id: randomUUID(),
        home: { kind: "task", taskId },
        roleKey,
        startedAt: new Date(startedAt),
      });
    const older = onTask(randomUUID(), "2026-10-25T09:00:00.000Z");
    const newer = onTask(randomUUID(), "2026-10-25T10:00:00.000Z");
    const someoneElses = aThread({
      id: randomUUID(),
      home: { kind: "task", taskId: randomUUID() },
      roleKey: `role-${randomUUID()}`,
    });
    for (const thread of [older, newer, someoneElses, aThreadOfItsOwn(roleKey)]) {
      await repository.add(thread);
    }

    await expect(repository.listOnTasksWith(roleKey)).resolves.toEqual([newer, older]);
  });

  it("keeps a Thread on an Initiative in its home, apart from the person's Threads on Tasks", async () => {
    const roleKey = `role-${randomUUID()}`;
    const home = { kind: "initiative", initiativeId: randomUUID() } as const;
    const shaping = aThread({ id: randomUUID(), home, roleKey, title: "Shaping" });
    await repository.add(shaping);

    await expect(repository.listIn(home)).resolves.toEqual([shaping]);
    await expect(repository.listOnTasksWith(roleKey)).resolves.toEqual([]);
  });

  it("finds a Thread by the engine session it has now", async () => {
    const roleKey = `role-${randomUUID()}`;
    const session = {
      id: randomUUID(),
      roleKey,
      cardVersion: 1,
      officeInstructionsVersion: 0,
      engineId: "claude-code",
      startedAt: AT,
      lastCallAt: undefined,
      contextTokens: 0,
      startContextTokens: undefined,
      full: false,
      changesAllowed: false,
    };
    const thread = aThreadOfItsOwn(roleKey, { session });
    await repository.add(thread);

    await expect(repository.findBySession(session.id)).resolves.toEqual(thread);
    await expect(repository.findBySession(randomUUID())).resolves.toBeUndefined();
  });

  it("saves nothing when the change changes nothing", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`, { title: "Deploys" });
    await repository.add(thread);

    const update = await repository.update(thread.id, (current) =>
      renameThread(current, "Deploys", AT),
    );

    expect(update).toEqual({ thread, event: undefined });
  });

  it("refuses to change a Thread that isn't there", async () => {
    const id = randomUUID();

    await expect(
      repository.update(id, (current) => renameThread(current, "Deploys", AT)),
    ).rejects.toThrow(new ThreadNotFound(id));
  });

  it("lets an answered Decision's approval through once", async () => {
    const taskId = randomUUID();
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`, { home: { kind: "task", taskId } });
    await repository.add(thread);
    const { thread: waiting } = await repository.update(thread.id, (current) =>
      openDecision(current, {
        id: randomUUID(),
        askedAt: AT,
        question: "Allow this call? Change the Developer.",
        context: "Why.",
        options: ["Allow once", "Deny"],
        recommendation: { option: 0, reason: "Needed." },
      }),
    );
    const decisionId = waiting.openDecisions[0]?.id ?? "";

    await expect(repository.spendApproval(decisionId)).resolves.toBe(true);
    await expect(repository.spendApproval(decisionId)).resolves.toBe(false);
    await expect(repository.spendApproval(randomUUID())).resolves.toBe(false);
    await expect(repository.decision(decisionId)).resolves.not.toHaveProperty("approvalSpentAt");
  });
});
