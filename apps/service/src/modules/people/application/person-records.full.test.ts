import { describe, expect, it } from "vitest";
import { aRole, aRoleCard } from "../domain/role.fixtures.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { dutiesOver } from "./duties.fixtures.js";
import { PersonRecords } from "./person-records.js";
import type { RoleService, RoleWithAssignments } from "./role-service.js";

function recordsOver(roles: RoleWithAssignments[]): PersonRecords {
  const service: Pick<RoleService, "list" | "read"> = {
    list: () => Promise.resolve(roles),
    read: (key) => {
      const found = roles.find(({ role }) => role.key === key);
      return found ? Promise.resolve(found) : Promise.reject(new RoleNotFound(key));
    },
  };
  return new PersonRecords(service as RoleService, dutiesOver(roles.map(({ role }) => role)));
}

describe("PersonRecords.of", () => {
  it("gives the person's short record, as list_people does", async () => {
    const jan = aRole({
      key: "planner",
      card: aRoleCard({
        name: "Jan",
        title: "Planner",
        responsibilities: "Writes Plans with you.",
        capabilities: { sharedMemory: false, chat: true, consultant: true, runEnvironment: false },
        taskLimit: 2,
      }),
    });

    const record = await recordsOver([{ role: jan, skills: [], mcpServers: [] }]).of("planner");

    expect(record).toBe(
      "Jan · Planner (Role planner)\nWrites Plans with you.\nChat on, Consultant; up to 2 Tasks at once.\nHolds: Plans.",
    );
  });

  it("says when the person was let go", async () => {
    const letGoAt = new Date("2026-11-01T10:00:00.000Z");
    const ada = aRole({ letGoAt });

    const record = await recordsOver([{ role: ada, skills: [], mcpServers: [] }]).of(ada.key);

    expect(record).toMatch(/\nLet go on 2026-11-01T10:00:00.000Z\.$/);
  });

  it("is undefined for a Role The Office doesn't have", async () => {
    expect(await recordsOver([]).of("nobody")).toBeUndefined();
  });
});

describe("PersonRecords.everyone", () => {
  it("says the duties each person holds, then the duties nobody holds with who stands in", async () => {
    const jan = aRole({ key: "planner", card: aRoleCard({ name: "Jan", title: "Planner" }) });
    const nina = aRole({ key: "devops", card: aRoleCard({ name: "Nina", title: "Devops" }) });

    const records = await recordsOver([
      { role: jan, skills: [], mcpServers: [] },
      { role: nina, skills: [], mcpServers: [] },
    ]).everyone();

    expect(records).toContain("Jan · Planner (Role planner)");
    expect(records).toMatch(/\nHolds: Plans\.\n\nNina · Devops/);
    expect(records).toContain(
      "Holds: Onboards and repairs Projects, Default Consultant for MCP tool hard switches.",
    );
    expect(records.split("\n\n").at(-1)).toBe(
      [
        "Nobody holds Default person to talk to: the Caretaker stands in.",
        "Nobody holds Shapes Initiatives: it falls to the user.",
        "Nobody holds Asked first when a Stage runs out of tries: it falls to the user.",
        "Nobody holds Implements: the Pipelines naming it can't start.",
        "Nobody holds Reviews: the Pipelines naming it can't start.",
      ].join("\n"),
    );
  });

  it("gives the person's record with the duties they hold", async () => {
    const nina = aRole({ key: "devops", card: aRoleCard({ name: "Nina", title: "Devops" }) });

    const record = await recordsOver([{ role: nina, skills: [], mcpServers: [] }]).of("devops");

    expect(record).toMatch(
      /\nHolds: Onboards and repairs Projects, Default Consultant for MCP tool hard switches\.$/,
    );
  });
});
