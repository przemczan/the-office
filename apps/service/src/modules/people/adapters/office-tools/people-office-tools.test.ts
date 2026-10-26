import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import type { RoleService, RoleWithSkills } from "../../application/role-service.js";
import { aRole, aRoleCard } from "../../domain/role.fixtures.js";
import { LIST_PEOPLE, PeopleOfficeTools } from "./people-office-tools.js";

function toolsOver(roles: RoleWithSkills[]): PeopleOfficeTools {
  const service: Pick<RoleService, "list"> = { list: () => Promise.resolve(roles) };
  return new PeopleOfficeTools(new OfficeToolRegistry(), service as RoleService);
}

describe("list_people", () => {
  it("reads each person's record, and names the Roles nobody fills", async () => {
    const ada = aRole();
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
    const tool = toolsOver([
      { role: jan, skills: ["definition-of-done"] },
      { role: ada, skills: [] },
    ]).listPeople();

    const result = await tool.run({}, { sessionId: "s-1" });

    expect(tool.name).toBe(LIST_PEOPLE);
    expect(result.isError).toBe(false);
    expect(result.text).toBe(
      [
        "Jan · Planner (Role planner)\nWrites Plans with you.\nChat on, Consultant; up to 2 Tasks at once. Skills: definition-of-done.",
        `Ada · Developer (Role developer)\n${ada.card.responsibilities}\nChat off, not a Consultant; up to 3 Tasks at once.`,
        "Nobody fills Reviewer, CTO, Devops, Office Manager yet: whoever would consult one of them asks the user.",
      ].join("\n\n"),
    );
  });

  it("says so when nobody is hired", async () => {
    const result = await toolsOver([]).listPeople().run({}, { sessionId: "s-1" });

    expect(result.text).toMatch(
      /^Nobody is hired yet\.\n\nNobody fills Planner, Developer, Reviewer/,
    );
  });

  it("is registered as the module starts", () => {
    const registry = new OfficeToolRegistry();

    new PeopleOfficeTools(registry, {} as RoleService).onModuleInit();

    expect(registry.named([LIST_PEOPLE]).map(({ name }) => name)).toEqual([LIST_PEOPLE]);
  });

  it("is People's only Office tool, so no session can change Roles (spec §9: Never in tier 1)", () => {
    const registered: string[] = [];
    class RecordingRegistry extends OfficeToolRegistry {
      override register(tool: Parameters<OfficeToolRegistry["register"]>[0]): void {
        registered.push(tool.name);
        super.register(tool);
      }
    }

    new PeopleOfficeTools(new RecordingRegistry(), {} as RoleService).onModuleInit();

    expect(registered).toEqual([LIST_PEOPLE]);
  });
});
