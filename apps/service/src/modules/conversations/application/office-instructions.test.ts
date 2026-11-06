import { describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { OfficeInstructionsVersionNotFound } from "../domain/office-instructions-version-not-found.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { OfficeInstructionsRepositoryForTests } from "../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructions } from "./office-instructions.js";

function officeInstructions(): OfficeInstructions {
  return new OfficeInstructions(new OfficeInstructionsRepositoryForTests(), new EventBus());
}

describe("OfficeInstructions", () => {
  it("answers version 0 with no text until one is saved", async () => {
    expect(await officeInstructions().current()).toEqual({ version: 0, text: "" });
  });

  it("makes each changed text the next version", async () => {
    const instructions = officeInstructions();

    expect(await instructions.save("Write in plain words.")).toEqual({
      version: 1,
      text: "Write in plain words.",
    });
    await instructions.save("Keep it short.");

    expect(await instructions.current()).toEqual({ version: 2, text: "Keep it short." });
  });

  it("makes no new version of the current text and answers the current version", async () => {
    const instructions = officeInstructions();
    await instructions.save("Write in plain words.");

    expect(await instructions.save("Write in plain words.")).toEqual({
      version: 1,
      text: "Write in plain words.",
    });
  });

  it("makes no version of an empty text while none is saved", async () => {
    const instructions = officeInstructions();

    expect(await instructions.save("")).toEqual({ version: 0, text: "" });
    await expect(instructions.forResumedSession(1)).rejects.toThrow(
      new OfficeInstructionsVersionNotFound(1),
    );
  });

  it("keeps an emptied text as a version of its own", async () => {
    const instructions = officeInstructions();
    await instructions.save("Write in plain words.");

    expect(await instructions.save("")).toEqual({ version: 2, text: "" });
  });

  it("replaces the text it was given as the one now", async () => {
    const instructions = officeInstructions();
    await instructions.save("Write in plain words.");

    expect(await instructions.replace("Write in plain words.", "Keep it short.")).toEqual({
      version: 2,
      text: "Keep it short.",
    });
  });

  it("refuses to replace any other text, saving nothing", async () => {
    const instructions = officeInstructions();
    await instructions.save("Edited in Settings.");

    await expect(instructions.replace("Write in plain words.", "Keep it short.")).rejects.toThrow(
      ProposalRefused,
    );
    expect(await instructions.current()).toEqual({ version: 1, text: "Edited in Settings." });
  });

  it("resumes a session with the version it recorded, across a change", async () => {
    const instructions = officeInstructions();
    await instructions.save("Write in plain words.");
    await instructions.save("Keep it short.");

    expect(await instructions.forResumedSession(1)).toEqual({
      version: 1,
      text: "Write in plain words.",
    });
  });

  it("resumes a session that recorded version 0 with none, after a change", async () => {
    const instructions = officeInstructions();
    await instructions.save("Write in plain words.");

    expect(await instructions.forResumedSession(0)).toEqual({ version: 0, text: "" });
  });

  it("refuses a version that was never saved", async () => {
    await expect(officeInstructions().forResumedSession(3)).rejects.toThrow(
      new OfficeInstructionsVersionNotFound(3),
    );
  });
});
