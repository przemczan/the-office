import {
  CAPTURE_IDEA_TOOL,
  SHOW_OFFICE_STATUS_TOOL as CONTRACT_SHOW_OFFICE_STATUS_TOOL,
} from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  CHANGE_ROLE_TOOL,
  CHAT_OFFICE_TOOLS,
  chatOfficeTools,
  OFFICE_MANAGER,
  POST_LINK_CARD_TOOL,
  PROPOSE_OFFICE_SETTING_TOOL,
  PROPOSE_ROLE_TOOL,
  SHOW_OFFICE_STATUS_TOOL,
} from "./session-instructions.js";

describe("chatOfficeTools", () => {
  it("gives a person's chat every chat tool", () => {
    expect(chatOfficeTools("planner")).toEqual(CHAT_OFFICE_TOOLS);
  });

  it("leaves creating a Task out of the Office Manager's, who points to the Planner", () => {
    const tools = chatOfficeTools(OFFICE_MANAGER);

    expect(tools).not.toContain("create_task");
    expect(tools).toContain("capture_idea");
  });

  it("gives the Office Manager drafting Roles and Office settings as Proposals, never changing one", () => {
    const tools = chatOfficeTools(OFFICE_MANAGER);

    expect(tools).toContain(PROPOSE_ROLE_TOOL);
    expect(tools).toContain(PROPOSE_OFFICE_SETTING_TOOL);
    expect(tools).not.toContain(CHANGE_ROLE_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_ROLE_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(PROPOSE_OFFICE_SETTING_TOOL);
  });

  it("gives only the Office Manager posting Link cards", () => {
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain(POST_LINK_CARD_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(POST_LINK_CARD_TOOL);
  });

  it("gives only the Office Manager showing the Office status", () => {
    expect(chatOfficeTools(OFFICE_MANAGER)).toContain(SHOW_OFFICE_STATUS_TOOL);
    expect(chatOfficeTools("planner")).not.toContain(SHOW_OFFICE_STATUS_TOOL);
  });

  it("names the tools whose calls the web shows as cards as the contracts name them", () => {
    expect(SHOW_OFFICE_STATUS_TOOL).toBe(CONTRACT_SHOW_OFFICE_STATUS_TOOL);
    expect(CHAT_OFFICE_TOOLS).toContain(CAPTURE_IDEA_TOOL);
  });
});
