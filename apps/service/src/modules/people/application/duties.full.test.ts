import { describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { DutyHolderChanged } from "../domain/duty-events.js";
import { DutyNotFound, DutyRefused } from "../domain/duty-refused.js";
import { ASK_ME, consult } from "../domain/hard-switches.js";
import type { Role } from "../domain/role.js";
import { aRole, aRoleCard } from "../domain/role.fixtures.js";
import { DutyRepositoryForTests } from "../ports/duty-repository.fixtures.js";
import { DutyChangeChecks } from "./duty-change-checks.js";
import { dutiesOver } from "./duties.fixtures.js";

const LEAD = aRole({ key: "lead", card: aRoleCard({ name: "Lea", title: "Lead" }) });
const PLANNER = aRole({ key: "planner", card: aRoleCard({ name: "Jan", title: "Planner" }) });
const DEVOPS = aRole({
  key: "devops",
  card: aRoleCard({
    name: "Nina",
    title: "Devops",
    capabilities: { sharedMemory: true, chat: true, consultant: true, runEnvironment: true },
  }),
});

/** Duties over `roles`, with what they publish and save. */
function office(roles: readonly Role[] = [LEAD, PLANNER, DEVOPS]) {
  const repository = new DutyRepositoryForTests();
  const events = new EventBus();
  const checks = new DutyChangeChecks();
  const published: DomainEvent[] = [];
  events.subscribeToEveryEvent((event) => void published.push(event));
  return { duties: dutiesOver(roles, repository, events, checks), repository, checks, published };
}

async function refusalOf(change: Promise<unknown>): Promise<readonly string[]> {
  const refusal: unknown = await change.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(refusal instanceof DutyRefused)) throw new Error("The change wasn't refused.");
  return refusal.reasons;
}

describe("Duties", () => {
  it("lists every duty in spec order, each holder with name and title", async () => {
    const list = await office().duties.list();

    expect(list.map((duty) => duty.duty)).toEqual([
      "default-person-to-talk-to",
      "shapes-initiatives",
      "asked-first-when-out-of-tries",
      "onboards-projects",
      "mcp-tool-consultant",
      "plans",
      "implements",
      "reviews",
    ]);
    expect(list.find((duty) => duty.duty === "plans")?.holder).toEqual({
      roleKey: "planner",
      name: "Jan",
      title: "Planner",
    });
    expect(list.find((duty) => duty.duty === "implements")).toMatchObject({
      holder: null,
      fallback: "unstaffed",
    });
  });

  it("answers who holds a duty and which duties a Role holds", async () => {
    const { duties } = office();
    await duties.change("reviews", "lead");

    expect(await duties.holderOf("plans")).toBe("planner");
    expect(await duties.holderOf("shapes-initiatives")).toBeUndefined();
    expect(await duties.heldBy("devops")).toEqual(["onboards-projects", "mcp-tool-consultant"]);
    expect(await duties.heldBy("lead")).toEqual(["reviews"]);
  });

  it("publishes one DutyHolderChanged on a real change, and nothing when it names the same Role", async () => {
    const { duties, published, repository } = office();

    const changed = await duties.change("plans", "lead");
    await duties.change("plans", "lead");

    expect(changed).toMatchObject({ set: true, roleKey: "lead", holder: { roleKey: "lead" } });
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(DutyHolderChanged);
    expect(published[0]).toMatchObject({ duty: "plans", from: "planner", to: "lead" });
    expect(repository.saves).toBe(1);
  });

  it("sets a duty to none, falling back as the duty says", async () => {
    const { duties, published } = office();

    expect(await duties.change("plans", null)).toMatchObject({
      set: true,
      roleKey: null,
      holder: null,
      fallback: "user",
    });
    expect(published[0]).toMatchObject({ duty: "plans", from: "planner", to: null });
  });

  it("refuses a Role not hired, a let-go Role and the Caretaker, saving nothing", async () => {
    const letGo = aRole({ key: "ops", letGoAt: new Date("2026-11-14T08:00:00.000Z") });
    const caretaker = aRole({ key: "caretaker" });
    const { duties, repository, published } = office([LEAD, letGo, caretaker]);

    expect(await refusalOf(duties.change("plans", "nobody"))).toEqual([
      'Plans goes to a hired Role, and nobody is hired as "nobody".',
    ]);
    expect(await refusalOf(duties.change("plans", "ops"))).toEqual([
      'Plans goes to a hired Role, and nobody is hired as "ops".',
    ]);
    expect(await refusalOf(duties.change("plans", "caretaker"))).toEqual([
      "The Caretaker is built in and holds no duty, so not Plans.",
    ]);
    expect(repository.saves).toBe(0);
    expect(published).toEqual([]);
  });

  it("throws DutyNotFound for a duty The Office doesn't have", async () => {
    await expect(office().duties.change("sweeps-floors", null)).rejects.toBeInstanceOf(
      DutyNotFound,
    );
  });

  it("dry-runs changes without saving, naming each problem", async () => {
    const { duties, repository } = office();

    expect(
      await duties.changeProblems([
        { duty: "plans", to: "lead" },
        { duty: "reviews", to: "nobody" },
      ]),
    ).toEqual(['Reviews goes to a hired Role, and nobody is hired as "nobody".']);
    expect(repository.saves).toBe(0);
  });

  it("changes several duties all at once", async () => {
    const { duties, published } = office();

    await duties.changeAll([
      { duty: "plans", from: "planner", to: "lead" },
      { duty: "reviews", from: "reviewer", to: "lead" },
    ]);

    expect(await duties.heldBy("lead")).toEqual(["plans", "reviews"]);
    expect(published.map((event) => (event as DutyHolderChanged).duty)).toEqual([
      "plans",
      "reviews",
    ]);
  });

  it("changes nothing when any duty names another Role than its from now", async () => {
    const { duties, repository } = office();
    await duties.change("reviews", "lead");

    expect(
      await refusalOf(
        duties.changeAll([
          { duty: "plans", from: "planner", to: "lead" },
          { duty: "reviews", from: "reviewer", to: null },
        ]),
      ),
    ).toEqual(["Reviews was changed meanwhile, so this change no longer applies."]);
    expect(await duties.holderOf("plans")).toBe("planner");
    expect(repository.saves).toBe(1);
  });

  it("runs every registered check before saving, refusing with its reasons", async () => {
    const { duties, checks, repository } = office();
    const weighed: unknown[] = [];
    checks.register((save) => {
      weighed.push(save);
      return Promise.resolve(save.to === "lead" ? ["Lea's engine can't work a Stage."] : []);
    });

    expect(await refusalOf(duties.change("plans", "lead"))).toEqual([
      "Lea's engine can't work a Stage.",
    ]);
    expect(await duties.changeProblems([{ duty: "plans", to: "lead" }])).toEqual([
      "Lea's engine can't work a Stage.",
    ]);
    expect(weighed).toContainEqual({ duty: "plans", from: "planner", to: "lead" });
    expect(repository.saves).toBe(0);
  });

  it("gives an MCP tool's default as consulting the holder, asking the user while unheld or not a Consultant", async () => {
    const quiet = aRole({
      key: "ops",
      card: aRoleCard({ capabilities: { ...DEVOPS.card.capabilities, consultant: false } }),
    });
    const { duties } = office([DEVOPS, quiet]);

    expect(await duties.mcpToolDefault()).toEqual(consult("devops"));
    await duties.change("mcp-tool-consultant", "ops");
    expect(await duties.mcpToolDefault()).toEqual(ASK_ME);
    await duties.change("mcp-tool-consultant", null);
    expect(await duties.mcpToolDefault()).toEqual(ASK_ME);
  });
});
