import { describe, expect, it } from "vitest";
import { aRole, aRoleCard } from "../domain/role.fixtures.js";
import { RoleNotFound } from "../domain/role-not-found.js";
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
  return new PersonRecords(service as RoleService);
}

describe("PersonRecords.of", () => {
  it("gives the person's short record, as list_people does", async () => {
    const jan = aRole({
      key: "planner",
      card: aRoleCard({
        name: "Jan",
        title: "Planner",
        responsibilities: "Writes Plans with you.",
        capabilities: { sharedMemory: false, chat: true, consultant: true },
        taskLimit: 2,
      }),
    });

    const record = await recordsOver([{ role: jan, skills: [], mcpServers: [] }]).of("planner");

    expect(record).toBe(
      "Jan · Planner (Role planner)\nWrites Plans with you.\nChat on, Consultant; up to 2 Tasks at once.",
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
