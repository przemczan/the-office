import type { ClaudeCodeEngine, EngineSettings } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  INITIATIVE_NONE_HINT,
  initiativeEngineSummary,
  initiativeEngineToast,
  initiativeNoneLabel,
  initiativeTaskEngine,
  projectEngineOf,
  taskEngineSummary,
  taskEngineToast,
  taskNoneHint,
  taskNoneLabel,
} from "./work-engine-words.ts";

const engineName = (engineId: string): string =>
  ({ work: "Work account", personal: "Personal" })[engineId] ?? engineId;

const OPUS_ON_PERSONAL = { engineId: "personal", model: "claude-opus-5-5" };
const SONNET_ON_WORK = { engineId: "work", model: "claude-sonnet-5-5" };
const HAIKU_ON_WORK = { engineId: "work", model: "claude-haiku-5-5" };
const WORK_ENGINE: ClaudeCodeEngine = {
  id: "work",
  name: "Work account",
  kind: "claude-code",
  defaultModel: "claude-haiku-5-5",
  defaultEffort: null,
  claudeCodeP: false,
};

describe("the Task's Engine fold's words", () => {
  it("sums up what it sets, else its Initiative's engine, else its Project's", () => {
    expect(
      taskEngineSummary({ engine: OPUS_ON_PERSONAL, initiativeEngine: null }, null, engineName),
    ).toBe("Opus 5.5 on Personal · set for this Task");
    expect(
      taskEngineSummary(
        { engine: null, initiativeEngine: OPUS_ON_PERSONAL },
        SONNET_ON_WORK,
        engineName,
      ),
    ).toBe("Initiative's engine · Opus 5.5 on Personal");
    expect(
      taskEngineSummary({ engine: null, initiativeEngine: null }, SONNET_ON_WORK, engineName),
    ).toBe("Project's engine · Sonnet 5.5 on Work account");
  });

  it("names the inherited engine in the empty choice while its Initiative sets one", () => {
    expect(taskNoneLabel({ initiativeEngine: OPUS_ON_PERSONAL }, engineName)).toBe(
      "Initiative's engine (Opus 5.5 on Personal)",
    );
    expect(taskNoneLabel({ initiativeEngine: null }, engineName)).toBe("Project's engine");
  });

  it("says in the hint where the engine it takes is set", () => {
    const shop = { name: "Shop", projectDefault: SONNET_ON_WORK };
    expect(taskNoneHint({ initiativeEngine: OPUS_ON_PERSONAL }, shop)).toBe(
      "Set on its Initiative. Pick an engine to run this Task on its own.",
    );
    expect(taskNoneHint({ initiativeEngine: null }, shop)).toBe(
      "Shop's Project default. Pick an engine to run this Task on its own.",
    );
    expect(taskNoneHint({ initiativeEngine: null }, { ...shop, projectDefault: null })).toBe(
      "The Office default, as Shop has no Project default. Pick an engine to run this Task on its own.",
    );
  });

  it("toasts a new engine, a new model alone and a cleared one", () => {
    const task = { title: "Export Stats as CSV", initiativeEngine: null };
    expect(taskEngineToast(task, null, OPUS_ON_PERSONAL, SONNET_ON_WORK, engineName)).toBe(
      "Engine saved for Export Stats as CSV: its next sessions start fresh, on Opus 5.5 on Personal.",
    );
    expect(taskEngineToast(task, null, HAIKU_ON_WORK, SONNET_ON_WORK, engineName)).toBe(
      "Model saved for Export Stats as CSV: its next sessions resume, on Haiku 5.5.",
    );
    expect(taskEngineToast(task, OPUS_ON_PERSONAL, null, SONNET_ON_WORK, engineName)).toBe(
      "Export Stats as CSV has no engine of its own now: it runs on its Project's engine from its next session.",
    );
    expect(
      taskEngineToast(
        { ...task, initiativeEngine: OPUS_ON_PERSONAL },
        HAIKU_ON_WORK,
        null,
        OPUS_ON_PERSONAL,
        engineName,
      ),
    ).toBe(
      "Export Stats as CSV has no engine of its own now: it runs on its Initiative's engine from its next session.",
    );
  });

  it("takes the Project default, else the Office default on its engine's default model", () => {
    const settings: Pick<EngineSettings, "engines" | "officeDefault"> = {
      engines: [
        { ...WORK_ENGINE, id: "personal", name: "Personal", defaultModel: "claude-opus-5-5" },
        WORK_ENGINE,
      ],
      officeDefault: { engineType: "claude-code", engineId: "work" },
    };

    expect(projectEngineOf({ projectDefault: SONNET_ON_WORK }, settings)).toEqual(SONNET_ON_WORK);
    expect(projectEngineOf({ projectDefault: null }, settings)).toEqual(HAIKU_ON_WORK);
    expect(
      projectEngineOf({ projectDefault: null }, { ...settings, officeDefault: null }),
    ).toBeNull();
    expect(projectEngineOf(undefined, undefined)).toBeNull();
  });
});

describe("the Initiative's Engine fold's words", () => {
  it("offers each Project's engine across several Projects", () => {
    expect(initiativeNoneLabel({ projectIds: ["shop"] })).toBe("Project's engine");
    expect(initiativeNoneLabel({ projectIds: ["shop", "site"] })).toBe("Each Project's engine");
    expect(
      initiativeEngineSummary({ engine: null, projectIds: ["shop", "site"] }, null, engineName),
    ).toBe("Each Project's engine");
    expect(
      initiativeEngineSummary({ engine: null, projectIds: ["shop"] }, SONNET_ON_WORK, engineName),
    ).toBe("Project's engine · Sonnet 5.5 on Work account");
    expect(
      initiativeEngineSummary({ engine: OPUS_ON_PERSONAL, projectIds: ["shop"] }, null, engineName),
    ).toBe("Opus 5.5 on Personal");
  });

  it("says in the hint that its Tasks fall back to the Office default where a Project has none", () => {
    expect(INITIATIVE_NONE_HINT).toBe(
      "A Task in it that sets no engine runs on its Project default, or the Office default where its Project has none.",
    );
  });

  it("toasts what its Threads and its open Tasks that set none run on", () => {
    const initiative = { name: "Usage reports" };
    expect(initiativeEngineToast(initiative, null, OPUS_ON_PERSONAL, 2, engineName)).toBe(
      "Engine saved for Usage reports: its Threads and its 2 open Tasks that set none run on Opus 5.5 on Personal from their next session.",
    );
    expect(
      initiativeEngineToast(
        initiative,
        OPUS_ON_PERSONAL,
        { ...OPUS_ON_PERSONAL, model: "claude-sonnet-5-5" },
        2,
        engineName,
      ),
    ).toBe("Model saved for Usage reports: its next sessions resume, on Sonnet 5.5.");
    expect(initiativeEngineToast(initiative, OPUS_ON_PERSONAL, null, 2, engineName)).toBe(
      "Usage reports has no engine of its own now: its Threads and Tasks run on their Project's engine from their next session.",
    );
  });

  it("says the level each of its Tasks takes", () => {
    expect(
      initiativeTaskEngine({ engine: HAIKU_ON_WORK }, { engine: OPUS_ON_PERSONAL }, SONNET_ON_WORK),
    ).toEqual({ engine: HAIKU_ON_WORK, source: "its own engine" });
    expect(
      initiativeTaskEngine({ engine: null }, { engine: OPUS_ON_PERSONAL }, SONNET_ON_WORK),
    ).toEqual({ engine: OPUS_ON_PERSONAL, source: "the Initiative's engine" });
    expect(initiativeTaskEngine({ engine: null }, { engine: null }, SONNET_ON_WORK)).toEqual({
      engine: SONNET_ON_WORK,
      source: "its Project's engine",
    });
  });
});
