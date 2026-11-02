import type { UsageSettings } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  capFieldProblem,
  draftChanged,
  draftOf,
  usageSettingsOf,
  withCapText,
  withMeasure,
} from "./usage-settings-draft.ts";

const SAVED: UsageSettings = {
  measures: ["fiveHourWindow", "tokens"],
  caps: [
    {
      engineId: "claude-code",
      windows: { fiveHour: 90, sevenDay: null },
      dailyTokens: null,
      dailyDollars: 12.5,
    },
    { engineId: "openai-compatible-api", dailyTokens: 2_000_000, dailyDollars: null },
  ],
};

describe("the Usage card's draft", () => {
  it("reads the saved settings back unchanged, the measures in the checkboxes' order", () => {
    const draft = draftOf(SAVED);

    expect(draft.measures).toEqual(["tokens", "fiveHourWindow"]);
    expect(draft.caps[0]).toEqual({
      engineId: "claude-code",
      windows: { fiveHour: "90", sevenDay: "" },
      dailyTokens: "",
      dailyDollars: "12.5",
    });
    expect(draftChanged(draft, SAVED)).toBe(false);
    expect(usageSettingsOf(draft)).toEqual({ ...SAVED, measures: ["tokens", "fiveHourWindow"] });
  });

  it("ticks and unticks measures, none ticked being settings too", () => {
    const ticked = withMeasure(draftOf(SAVED), "cost", true);
    expect(ticked.measures).toEqual(["tokens", "fiveHourWindow", "cost"]);

    const none = (["tokens", "fiveHourWindow", "cost"] as const).reduce(
      (draft, measure) => withMeasure(draft, measure, false),
      ticked,
    );
    expect(usageSettingsOf(none)?.measures).toEqual([]);
  });

  it("turns a cap off when its field is emptied and reads tokens with thousands separators", () => {
    let draft = withCapText(draftOf(SAVED), "claude-code", "fiveHour", "");
    draft = withCapText(draft, "openai-compatible-api", "dailyTokens", "300,000");

    expect(usageSettingsOf(draft)?.caps).toEqual([
      { ...SAVED.caps[0], windows: { fiveHour: null, sevenDay: null } },
      { engineId: "openai-compatible-api", dailyTokens: 300_000, dailyDollars: null },
    ]);
    expect(draftChanged(draft, SAVED)).toBe(true);
    expect(
      draftChanged(
        withCapText(draftOf(SAVED), "openai-compatible-api", "dailyTokens", "2,000,000"),
        SAVED,
      ),
    ).toBe(false);
  });

  it.each([
    ["fiveHour", "0"],
    ["sevenDay", "101"],
    ["fiveHour", "50.5"],
    ["dailyTokens", "0"],
    ["dailyTokens", "1.5"],
    ["dailyDollars", "-3"],
    ["dailyDollars", "ten"],
  ] as const)("holds Save on a %s cap of %s", (kind, text) => {
    expect(capFieldProblem(kind, text)).toBeDefined();
    expect(usageSettingsOf(withCapText(draftOf(SAVED), "claude-code", kind, text))).toBeUndefined();
  });
});
