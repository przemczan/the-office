import { describe, expect, it } from "vitest";
import { codex } from "./engine-settings.fixtures.js";
import { FIRST_CLAUDE_CODE_ENGINE, type ClaudeCodeEngine, type EngineId } from "./engines.js";
import { engineThroughStandIns, engineToRunOn } from "./stand-in-engines.js";

const work: ClaudeCodeEngine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "work", name: "Work" };
const home: ClaudeCodeEngine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "home", name: "Home" };
const spare: ClaudeCodeEngine = { ...FIRST_CLAUDE_CODE_ENGINE, id: "spare", name: "Spare" };
const engines = [work, home, spare, codex];
const cascade = { engineId: "work", model: "claude-sonnet-5-5" };

function withRoom(...engineIds: EngineId[]): (engineId: EngineId) => boolean {
  return (engineId) => engineIds.includes(engineId);
}

describe("engineToRunOn", () => {
  it("runs on the cascade's engine while it has room", () => {
    expect(
      engineToRunOn(cascade, { engines, standInEngines: ["home"] }, withRoom("work", "home")),
    ).toBe(cascade);
  });

  it("takes the first Stand-in Engine in order with room, keeping the model", () => {
    expect(
      engineToRunOn(
        cascade,
        { engines, standInEngines: ["spare", "home"] },
        withRoom("home", "spare"),
      ),
    ).toEqual({ engineId: "spare", model: "claude-sonnet-5-5" });
  });

  it("gives stand-ins to a cascade engine that isn't listed itself", () => {
    expect(engineToRunOn(cascade, { engines, standInEngines: ["home"] }, withRoom("home"))).toEqual(
      {
        engineId: "home",
        model: "claude-sonnet-5-5",
      },
    );
  });

  it("skips the cascade's own engine, an unlisted engine, one serving another model and one with no room", () => {
    const asked: EngineId[] = [];
    const hasRoom = (engineId: EngineId) => {
      asked.push(engineId);
      return withRoom("gone", "codex", "spare")(engineId);
    };

    expect(
      engineToRunOn(
        cascade,
        { engines, standInEngines: ["work", "gone", "codex", "home", "spare"] },
        hasRoom,
      ),
    ).toEqual({ engineId: "spare", model: "claude-sonnet-5-5" });
    expect(asked).toEqual(["work", "home", "spare"]);
  });

  it("runs on none when no engine serving the model has room", () => {
    expect(
      engineToRunOn(cascade, { engines, standInEngines: ["home", "codex"] }, withRoom("codex")),
    ).toBeNull();
    expect(engineToRunOn(cascade, { engines, standInEngines: [] }, withRoom())).toBeNull();
  });
});

describe("engineThroughStandIns", () => {
  const standIns = [{ engineId: "work", standInId: "home" }];

  it("maps the cascade's engine to the stand-in recorded for it, keeping the model", () => {
    expect(engineThroughStandIns(cascade, standIns, engines)).toEqual({
      engineId: "home",
      model: "claude-sonnet-5-5",
    });
  });

  it("keeps an engine no stand-in is recorded for", () => {
    const other = { engineId: "spare", model: "claude-sonnet-5-5" };

    expect(engineThroughStandIns(other, standIns, engines)).toBe(other);
  });

  it("maps back to the cascade's engine once the stand-in is removed", () => {
    expect(engineThroughStandIns(cascade, standIns, [work, spare])).toBe(cascade);
  });

  it("maps back to the cascade's engine once the stand-in no longer serves the model", () => {
    expect(
      engineThroughStandIns(cascade, [{ engineId: "work", standInId: "codex" }], engines),
    ).toBe(cascade);
  });
});
