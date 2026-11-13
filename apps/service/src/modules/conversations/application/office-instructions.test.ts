import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { OfficeInstructionsRepositoryForTests } from "../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructions } from "./office-instructions.js";
import { ANN_LEE } from "../domain/user.fixtures.js";

function officeInstructions(): OfficeInstructions {
  return new OfficeInstructions(new OfficeInstructionsRepositoryForTests(), new EventBus());
}

describe("OfficeInstructions", () => {
  it("makes each changed text the next version", async () => {
    const instructions = officeInstructions();

    expect(await instructions.save("Write in plain words.", ANN_LEE)).toEqual({
      version: 1,
      text: "Write in plain words.",
    });
    await instructions.save("Keep it short.", ANN_LEE);

    expect(await instructions.current()).toEqual({ version: 2, text: "Keep it short." });
  });

  it("refuses to replace any other text, saving nothing", async () => {
    const instructions = officeInstructions();
    await instructions.save("Edited in Settings.", ANN_LEE);

    await expect(
      instructions.replace("Write in plain words.", "Keep it short.", ANN_LEE),
    ).rejects.toThrow(ProposalRefused);
    expect(await instructions.current()).toEqual({ version: 1, text: "Edited in Settings." });
  });
});
