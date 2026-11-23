import { describe, expect, it } from "vitest";
import { codex } from "./engine-settings.fixtures.js";
import { FIRST_CLAUDE_CODE_ENGINE, type ClaudeCodeEngine, type EngineId } from "./engines.js";
import {
  engineThroughStandIns,
  engineToRunOn,
  standInListProblems,
  standInListWithout,
} from "./stand-in-engines.js";

const work: ClaudeCodeEngine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "work", name: "Work" };
const home: ClaudeCodeEngine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "home", name: "Home" };
const spare: ClaudeCodeEngine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "spare", name: "Spare" };
const engines = [work, home, spare, codex];

function withRoom(...engineIds: EngineId[]): (engineId: EngineId) => boolean {
  return (engineId) => engineIds.includes(engineId);
}

describe("engineToRunOn", () => {
  it("runs on the cascade's engine while it has room", () => {
    expect(engineToRunOn("work", ["home"], engines, withRoom("work", "home"))).toBe("work");
  });

  it("takes the first Stand-in Engine in order with room", () => {
    expect(engineToRunOn("work", ["spare", "home"], engines, withRoom("home", "spare"))).toBe(
      "spare",
    );
  });

  it("gives stand-ins to a cascade engine that isn't listed itself", () => {
    expect(engineToRunOn("work", ["home"], engines, withRoom("home"))).toBe("home");
  });

  it("takes a stand-in of another engine type", () => {
    expect(engineToRunOn("work", [codex.id, "home"], engines, withRoom(codex.id, "home"))).toBe(
      codex.id,
    );
  });

  it("with sameEngineType, takes only stand-ins of the cascade's engine type", () => {
    expect(
      engineToRunOn("work", [codex.id, "home"], engines, withRoom(codex.id, "home"), {
        sameEngineType: true,
      }),
    ).toBe("home");
    expect(
      engineToRunOn("work", [codex.id], engines, withRoom(codex.id), { sameEngineType: true }),
    ).toBeNull();
  });

  it("passes over a stand-in lacking a capability the session needs", () => {
    expect(
      engineToRunOn("work", [codex.id, "spare"], engines, withRoom(codex.id, "spare"), {
        capable: (engineId) => engineId !== codex.id,
      }),
    ).toBe("spare");
  });

  it("skips the cascade's own engine, an unlisted engine and one with no room", () => {
    const asked: EngineId[] = [];
    const hasRoom = (engineId: EngineId) => {
      asked.push(engineId);
      return withRoom("gone", "spare")(engineId);
    };

    expect(engineToRunOn("work", ["work", "gone", "home", "spare"], engines, hasRoom)).toBe(
      "spare",
    );
    expect(asked).toEqual(["work", "home", "spare"]);
  });

  it("runs on none when no stand-in has room, or the list is empty", () => {
    expect(engineToRunOn("work", ["home", codex.id], engines, withRoom())).toBeNull();
    expect(engineToRunOn("work", [], engines, withRoom("home"))).toBeNull();
  });
});

describe("engineThroughStandIns", () => {
  const choices = [{ engineId: "work", standInId: "home" }];

  it("maps the cascade's engine to the stand-in recorded for it", () => {
    expect(engineThroughStandIns("work", choices, engines, ["home"])).toBe("home");
  });

  it("maps to a recorded stand-in of another engine type", () => {
    expect(
      engineThroughStandIns("work", [{ engineId: "work", standInId: codex.id }], engines, [
        codex.id,
      ]),
    ).toBe(codex.id);
  });

  it("keeps an engine no stand-in is recorded for", () => {
    expect(engineThroughStandIns("spare", choices, engines, ["home"])).toBe("spare");
  });

  it("maps back to the cascade's engine once the stand-in is removed", () => {
    expect(engineThroughStandIns("work", choices, [work, spare], ["home"])).toBe("work");
  });

  it("maps back to the cascade's engine once the stand-in is no longer in the list that applies", () => {
    expect(engineThroughStandIns("work", choices, engines, ["spare"])).toBe("work");
  });
});

describe("standInListProblems", () => {
  it("passes a list of listed engines, each once, of any type", () => {
    expect(standInListProblems(["home", codex.id], engines)).toEqual([]);
  });

  it("refuses an engine not listed and one named twice", () => {
    expect(standInListProblems(["gone", "home", "home"], engines)).toEqual([
      "Pick each Stand-in Engine among the engines listed.",
      '"Home" is listed twice as a Stand-in Engine.',
    ]);
  });
});

describe("standInListWithout", () => {
  it("puts the replacement in the removed engine's place", () => {
    expect(standInListWithout(["home", "work", "spare"], "work", codex.id)).toEqual([
      "home",
      codex.id,
      "spare",
    ]);
  });

  it("just drops the removed engine when the list already names the replacement", () => {
    expect(standInListWithout(["home", "work", "spare"], "work", "spare")).toEqual([
      "home",
      "spare",
    ]);
  });

  it("just drops the removed engine with no replacement", () => {
    expect(standInListWithout(["work"], "work", null)).toEqual([]);
  });

  it("keeps a list not naming the removed engine", () => {
    expect(standInListWithout(["home", "spare"], "work", codex.id)).toEqual(["home", "spare"]);
  });
});
