import { describe, expect, it } from "vitest";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { PersonRecords } from "../../application/person-records.js";
import type { RoleService } from "../../application/role-service.js";
import { aRole, aRoleCard } from "../../domain/role.fixtures.js";
import { LIST_PEOPLE, PeopleOfficeTools, READ_ROLE } from "./people-office-tools.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { toolsOver } from "./people-office-tools.fixtures.js";

describe("list_people", () => {
  it("reads each person's record, and names the Roles nobody fills", async () => {
    const ada = aRole();
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
    const tool = toolsOver([
      { role: jan, skills: ["definition-of-done"], mcpServers: [] },
      { role: ada, skills: [], mcpServers: [] },
    ]).listPeople();

    const result = await tool.run({}, anOfficeToolCall("s-1"));

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
});

describe("People's Office tools", () => {
  it("only read, so no session can change Roles through them (spec §9: Never in tier 1)", () => {
    const registered: string[] = [];
    class RecordingRegistry extends OfficeToolRegistry {
      override register(tool: Parameters<OfficeToolRegistry["register"]>[0]): void {
        registered.push(tool.name);
        super.register(tool);
      }
    }

    new PeopleOfficeTools(
      new RecordingRegistry(),
      {} as RoleService,
      {} as PersonRecords,
    ).onModuleInit();

    expect(registered).toEqual([LIST_PEOPLE, READ_ROLE]);
  });
});
