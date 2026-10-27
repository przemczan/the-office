import { describe, expect, it } from "vitest";
import { CHAT_OFFICE_TOOLS, chatOfficeTools, OFFICE_MANAGER } from "./session-instructions.js";

describe("chatOfficeTools", () => {
  it("gives a person's chat every chat tool", () => {
    expect(chatOfficeTools("planner")).toEqual(CHAT_OFFICE_TOOLS);
  });

  it("leaves creating a Task out of the Office Manager's, who points to the Planner", () => {
    const tools = chatOfficeTools(OFFICE_MANAGER);

    expect(tools).not.toContain("create_task");
    expect(tools).toContain("capture_idea");
    expect(tools).toHaveLength(CHAT_OFFICE_TOOLS.length - 1);
  });
});
