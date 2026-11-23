import { describe, expect, it } from "vitest";
import { FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../../engine/index.js";
import type { DailyCapsAtStart, UsageAtStart, WindowsAtStart } from "./cap-waits.js";
import {
  onStandIns,
  standInsWithStarted,
  type StandInEngineAtStart,
  type StandInsAtStart,
} from "./stand-ins-at-start.js";
import type { EngineUsage } from "./usage-estimate.js";

const NOW = new Date(2026, 10, 2, 9, 0);
const IN_THREE_HOURS = new Date(2026, 10, 2, 12, 0);
const IN_FOUR_HOURS = new Date(2026, 10, 2, 13, 0);
const IN_HALF_AN_HOUR = new Date(2026, 10, 2, 9, 30);

const engine = (id: string, name: string): Engine => ({ ...FIRST_CLAUDE_CODE_ENGINE, id, name });
const ENGINES: readonly Engine[] = [
  engine("work", "Work"),
  engine("personal", "Personal"),
  engine("spare", "Spare"),
  engine("home", "Home"),
  {
    kind: "codex",
    id: "lab",
    name: "Lab",
    defaultModel: "gpt-5.5",
    defaultEffort: null,
    apiKey: null,
  },
];
const ENGINE_NAMES = new Map(ENGINES.map(({ id, name }) => [id, name] as const));

/** Doubles the window % of the cascade's estimate, so a moved estimate shows the stand-in's ratios. */
const RATIOS = { fiveHour: 0.02, sevenDay: 0.002 };

function windows(engineId: string, percentUsed: number, resetsAt = IN_THREE_HOURS): WindowsAtStart {
  return {
    engineId,
    caps: { fiveHour: 80, sevenDay: undefined },
    reading: {
      readAt: new Date(2026, 10, 2, 8, 50),
      fiveHour: { percentUsed, resetsAt },
      sevenDay: { percentUsed: 10, resetsAt: new Date(2026, 10, 5, 14, 30) },
    },
    startedSinceReading: { fiveHour: 0, sevenDay: 0 },
  };
}

function daily(engineId: string, tokensToday: number): DailyCapsAtStart {
  return {
    engineId,
    caps: { tokens: 10_000, dollars: undefined },
    today: { tokens: tokensToday, dollars: 0 },
    inProgress: { tokens: 0, dollars: 0 },
  };
}

function estimate(engineId: string, fiveHour: number): EngineUsage {
  return { engineId, tokens: 1000, windows: { fiveHour, sevenDay: 1 }, cost: 0.5 };
}

function usage(fields: Partial<UsageAtStart> = {}): UsageAtStart {
  return {
    now: NOW,
    measures: ["tokens", "fiveHourWindow"],
    estimate: [estimate("work", 10)],
    windows: [windows("work", 75)],
    daily: [],
    engineNames: ENGINE_NAMES,
    usedUp: [],
    ...fields,
  };
}

function standIn(
  engineId: string,
  fields: Partial<StandInEngineAtStart> = {},
): StandInEngineAtStart {
  return {
    engineId,
    windows: windows(engineId, 20),
    daily: undefined,
    usedUp: undefined,
    windowRatios: RATIOS,
    ...fields,
  };
}

function standIns(
  listed: readonly StandInEngineAtStart[],
  cascadeEngines: readonly string[] = ["work"],
  capable?: (engineId: string) => boolean,
): StandInsAtStart {
  return {
    engines: ENGINES,
    order: listed.map(({ engineId }) => engineId),
    cascadeEngines,
    ...(capable && { capable }),
    standIns: listed,
  };
}

/** Every engine but Lab has what the Task's Agent Stages need. */
const labIncapable = (engineId: string): boolean => engineId !== "lab";

const WORK_CAP_WORDS =
  "The Work engine's 5-hour window would pass its 80% cap: 75% used, 0% expected of the Tasks started since it was read and 10% of this Task. It resets at 12:00.";

describe("onStandIns", () => {
  it("keeps the cascade's engine while it has room", () => {
    const roomy = usage({ windows: [windows("work", 20)] });

    const weighed = onStandIns(roomy, standIns([standIn("personal")]));

    expect(weighed).toEqual({ usage: roomy, standIns: [], waits: [], resets: [] });
  });

  it("hands a Window cap's engine to the first Stand-in Engine with room, moving the estimate", () => {
    const weighed = onStandIns(
      usage(),
      standIns([standIn("spare", { windows: windows("spare", 79) }), standIn("personal")]),
    );

    expect(weighed.standIns).toEqual([
      {
        engineId: "work",
        standInId: "personal",
        engineName: "Work",
        standInName: "Personal",
        reason: WORK_CAP_WORDS,
        short: "5-hour window cap (80%) · resets 12:00",
      },
    ]);
    expect(weighed.waits).toEqual([]);
    expect(weighed.usage.estimate).toEqual([
      { engineId: "personal", tokens: 1000, windows: { fiveHour: 20, sevenDay: 2 }, cost: 0.5 },
    ]);
    expect(weighed.usage.windows.map(({ engineId }) => engineId)).toEqual(["personal"]);
  });

  it("hands on an engine whose usage window is used up", () => {
    const usedUp = usage({
      windows: [],
      usedUp: [{ engineId: "work", windowWords: "5-hour window", until: IN_THREE_HOURS }],
    });

    const weighed = onStandIns(usedUp, standIns([standIn("personal")]));

    expect(weighed.standIns).toEqual([
      {
        engineId: "work",
        standInId: "personal",
        engineName: "Work",
        standInName: "Personal",
        reason: "Work's 5-hour window is used up until 12:00.",
        short: "5-hour window used up · until 12:00",
      },
    ]);
    expect(weighed.waits).toEqual([]);
  });

  it("skips a Stand-in Engine over a cap, used up, over its Daily cap or lacking a capability", () => {
    const weighed = onStandIns(
      usage(),
      standIns(
        [
          standIn("lab"),
          standIn("spare", {
            usedUp: { engineId: "spare", windowWords: "7-day window", until: IN_FOUR_HOURS },
          }),
          standIn("personal", { daily: daily("personal", 9500) }),
          standIn("home", { windows: windows("home", 75) }),
        ],
        ["work"],
        labIncapable,
      ),
    );

    expect(weighed.standIns).toEqual([]);
  });

  it("hands the Stages to a Stand-in Engine of another engine type", () => {
    const weighed = onStandIns(usage(), standIns([standIn("lab")]));

    expect(weighed.standIns).toEqual([
      expect.objectContaining({ engineId: "work", standInId: "lab", standInName: "Lab" }),
    ]);
    expect(weighed.waits).toEqual([]);
  });

  it("passes over an incapable Stand-in Engine for the next capable one with room", () => {
    const weighed = onStandIns(
      usage(),
      standIns([standIn("lab"), standIn("personal")], ["work"], labIncapable),
    );

    expect(weighed.standIns.map(({ standInId }) => standInId)).toEqual(["personal"]);
  });

  it("weighs only the stand-ins of the list that applies", () => {
    const listed = standIns([standIn("personal"), standIn("spare")]);

    const weighed = onStandIns(usage(), { ...listed, order: ["spare"] });

    expect(weighed.standIns.map(({ standInId }) => standInId)).toEqual(["spare"]);
  });

  it("counts a Daily cap on the Stand-in Engine with the Task's tokens moved onto it", () => {
    const measures = ["tokens", "fiveHourWindow"] as const;
    const roomyToday = standIn("personal", { daily: daily("personal", 8000) });

    expect(onStandIns(usage({ measures }), standIns([roomyToday])).standIns).toHaveLength(1);
  });

  it("queues for a Daily cap alone, handing nothing on", () => {
    const dailyOnly = usage({ windows: [windows("work", 20)], daily: [daily("work", 9500)] });

    const weighed = onStandIns(dailyOnly, standIns([standIn("personal")]));

    expect(weighed.standIns).toEqual([]);
    expect(weighed.waits).toEqual([
      expect.objectContaining({ short: "Daily cap (10,000 tokens) · resets at midnight" }),
    ]);
  });

  it("stays on the cascade's engine when its cap resets within the prompt cache's hour", () => {
    const soon = usage({ windows: [windows("work", 75, IN_HALF_AN_HOUR)] });

    const weighed = onStandIns(soon, standIns([standIn("personal")]));

    expect(weighed).toEqual({ usage: soon, standIns: [], waits: [], resets: [] });
  });

  it("counts both estimates on a Stand-in Engine the Task already spends on", () => {
    const both = usage({
      estimate: [estimate("work", 10), estimate("personal", 50)],
      windows: [windows("work", 75), windows("personal", 20)],
    });
    const weighed = onStandIns(both, standIns([standIn("personal")], ["work", "personal"]));

    expect(weighed.standIns).toEqual([]);
    expect(weighed.waits.map(({ short }) => short)).toContain("No stand-in with room");
  });

  it("merges the moved estimate with the Stand-in Engine's own when it has room for both", () => {
    const both = usage({
      estimate: [estimate("work", 10), estimate("personal", 5)],
      windows: [windows("work", 75), windows("personal", 20)],
    });
    const weighed = onStandIns(both, standIns([standIn("personal")], ["work", "personal"]));

    expect(weighed.standIns.map(({ standInId }) => standInId)).toEqual(["personal"]);
    expect(weighed.usage.estimate).toEqual([
      { engineId: "personal", tokens: 2000, windows: { fiveHour: 25, sevenDay: 3 }, cost: 1 },
    ]);
  });

  it("queues with the added wait and each stand-in's reset when none has room", () => {
    const weighed = onStandIns(
      usage(),
      standIns([standIn("personal", { windows: windows("personal", 70, IN_FOUR_HOURS) })]),
    );

    expect(weighed.standIns).toEqual([]);
    expect(weighed.waits).toEqual([
      { reason: WORK_CAP_WORDS, short: "5-hour window cap (80%) · resets 12:00" },
      {
        reason:
          "No Stand-in Engine has room either: Personal: 5-hour window cap (80%) · resets 13:00.",
        short: "No stand-in with room",
      },
    ]);
    expect(weighed.resets).toEqual([IN_THREE_HOURS, IN_FOUR_HOURS]);
  });

  it("leaves the reasons as they are with no capable Stand-in Engine", () => {
    const withoutStandIns = onStandIns(usage(), standIns([]));
    const withLabOnly = onStandIns(usage(), standIns([standIn("lab")], ["work"], labIncapable));

    expect(withoutStandIns.waits).toEqual([
      { reason: WORK_CAP_WORDS, short: "5-hour window cap (80%) · resets 12:00" },
    ]);
    expect(withLabOnly).toEqual(withoutStandIns);
  });
});

describe("onStandIns past the usage caps", () => {
  it("starts on the cascade's engine over its cap, as the caps hold nothing", () => {
    const capped = usage({ daily: [daily("work", 9500)] });

    const weighed = onStandIns(capped, standIns([standIn("personal")]), "start-anyway");

    expect(weighed).toEqual({ usage: capped, standIns: [], waits: [], resets: [] });
  });

  it("hands a used-up engine to the first Stand-in Engine whose window isn't used up, over its cap", () => {
    const usedUp = usage({
      usedUp: [{ engineId: "work", windowWords: "7-day window", until: IN_FOUR_HOURS }],
    });

    const weighed = onStandIns(
      usedUp,
      standIns([
        standIn("spare", {
          usedUp: { engineId: "spare", windowWords: "5-hour window", until: IN_THREE_HOURS },
        }),
        standIn("personal", { windows: windows("personal", 95), daily: daily("personal", 9500) }),
      ]),
      "start-anyway",
    );

    expect(weighed.standIns.map(({ standInId }) => standInId)).toEqual(["personal"]);
    expect(weighed.waits).toEqual([]);
  });

  it("waits only for a used-up window when no Stand-in Engine has a window left", () => {
    const usedUp = usage({
      usedUp: [{ engineId: "work", windowWords: "7-day window", until: IN_FOUR_HOURS }],
    });

    const weighed = onStandIns(
      usedUp,
      standIns([
        standIn("personal", {
          usedUp: { engineId: "personal", windowWords: "5-hour window", until: IN_THREE_HOURS },
        }),
      ]),
      "start-anyway",
    );

    expect(weighed.waits).toEqual([
      { reason: "Work's 7-day window is used up until 13:00.", short: expect.any(String) },
      {
        reason:
          "No Stand-in Engine has room either: Personal: 5-hour window used up · until 12:00.",
        short: "No stand-in with room",
      },
    ]);
  });
});

describe("standInsWithStarted", () => {
  it("counts a Task started in the same release against the Stand-in Engine's windows and Daily caps", () => {
    const listed = standIns([standIn("personal", { daily: daily("personal", 0) })]);

    const counted = standInsWithStarted(listed, [estimate("personal", 30)]);

    expect(counted.standIns[0]?.windows?.startedSinceReading.fiveHour).toBe(30);
    expect(counted.standIns[0]?.daily?.inProgress).toEqual({ tokens: 1000, dollars: 0.5 });
  });
});

/** The Task's engine forced by an override, with no list, as the cascade gives it then. */
function forced(forcedBy: "task" | "initiative"): StandInsAtStart {
  return { ...standIns([]), forcedBy };
}

describe("onStandIns under an engine override", () => {
  it("keeps the forced engine while it has room", () => {
    const weighed = onStandIns(usage({ windows: [windows("work", 20)] }), forced("task"));

    expect(weighed).toMatchObject({ standIns: [], waits: [], resets: [] });
  });

  it("waits for the forced engine's reset, naming the override, with no stand-in", () => {
    const weighed = onStandIns(usage(), forced("task"));

    expect(weighed.standIns).toEqual([]);
    expect(weighed.waits).toEqual([
      { reason: WORK_CAP_WORDS, short: "5-hour window cap (80%) · resets 12:00" },
      {
        reason:
          "Work is set for this Task (it uses no Stand-in Engine) and waits for the reset at 12:00.",
        short: "Work is set for this Task · resets 12:00",
      },
    ]);
    expect(weighed.resets).toEqual([IN_THREE_HOURS]);
  });

  it("names the Initiative when its override forces the engine", () => {
    const weighed = onStandIns(usage(), forced("initiative"));

    expect(weighed.waits.at(-1)).toEqual({
      reason:
        "Work is set for its Initiative (it uses no Stand-in Engine) and waits for the reset at 12:00.",
      short: "Work is set for its Initiative · resets 12:00",
    });
  });

  it("hands nothing on even to a listed Stand-in Engine with room, as the override forces it", () => {
    const listed = standIns([standIn("personal")]);

    const weighed = onStandIns(usage(), { ...listed, forcedBy: "task" });

    expect(weighed.standIns).toEqual([]);
    expect(weighed.resets).toEqual([IN_THREE_HOURS]);
  });

  it("waits with the day of a reset on another day", () => {
    const usedUp = usage({
      windows: [],
      usedUp: [
        { engineId: "work", windowWords: "7-day window", until: new Date(2026, 10, 5, 14, 30) },
      ],
    });

    const weighed = onStandIns(usedUp, forced("task"));

    expect(weighed.waits.at(-1)).toEqual({
      reason:
        "Work is set for this Task (it uses no Stand-in Engine) and waits for the reset on Thu 5 Nov at 14:30.",
      short: "Work is set for this Task · resets Thu 5 Nov 14:30",
    });
  });

  it("tries only the forced engine past the usage caps: a used-up window still holds it", () => {
    const usedUp = usage({
      usedUp: [{ engineId: "work", windowWords: "7-day window", until: IN_FOUR_HOURS }],
    });

    const weighed = onStandIns(usedUp, forced("task"), "start-anyway");

    expect(weighed.standIns).toEqual([]);
    expect(weighed.waits).toEqual([
      { reason: "Work's 7-day window is used up until 13:00.", short: expect.any(String) },
      {
        reason:
          "Work is set for this Task (it uses no Stand-in Engine) and waits for the reset at 13:00.",
        short: "Work is set for this Task · resets 13:00",
      },
    ]);
    expect(onStandIns(usage(), forced("task"), "start-anyway").waits).toEqual([]);
  });

  it("queues for a Daily cap alone, with no word of the override", () => {
    const dailyOnly = usage({ windows: [windows("work", 20)], daily: [daily("work", 9500)] });

    const weighed = onStandIns(dailyOnly, forced("task"));

    expect(weighed.waits).toHaveLength(1);
    expect(weighed.waits[0]?.reason).not.toContain("is set for");
  });
});
