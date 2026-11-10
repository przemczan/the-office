import { describe, expect, it } from "vitest";
import { linux } from "../../../../platform/os/linux.js";
import { windows } from "../../../../platform/os/windows.js";
import { engineTaskFolder } from "./engine-task-folder.js";

const raw = String.raw;

// The folders are the ones the engine wrote a background command's output to in task 06's probes.
describe("engineTaskFolder", () => {
  it("names the folder the engine writes a session's background output to on Windows", () => {
    const system = windows({
      variables: { TEMP: raw`C:\Users\przem\AppData\Local\Temp` },
      homeDirectory: raw`C:\Users\przem`,
    });

    expect(
      engineTaskFolder(
        system,
        raw`C:\Users\przem\AppData\Local\Temp\office-probe-by01v9`,
        "9d07c7b4-39e7-440b-afd2-d7888a6bacf7",
      ),
    ).toBe(
      raw`C:\Users\przem\AppData\Local\Temp\claude\C--Users-przem-AppData-Local-Temp-office-probe-by01v9\9d07c7b4-39e7-440b-afd2-d7888a6bacf7\tasks`,
    );
  });

  it("names the folder the engine writes a session's background output to on Linux", () => {
    const system = linux({ variables: {}, homeDirectory: "/root", userId: 0 });

    expect(
      engineTaskFolder(system, "/tmp/office-probe-JGuYsP", "479d801d-1cdc-4064-ac9d-d2afb0148d14"),
    ).toBe("/tmp/claude-0/-tmp-office-probe-JGuYsP/479d801d-1cdc-4064-ac9d-d2afb0148d14/tasks");
  });
});
