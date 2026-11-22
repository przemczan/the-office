import { describe, expect, it } from "vitest";
import { cardMarks, type CardFacts } from "./card-marks.ts";

const READY: CardFacts = {
  state: "ready",
  waiting: false,
  blockers: 0,
  queued: false,
  hasUsageEstimate: false,
  someoneWorking: false,
  atStage: false,
  hasPlanner: true,
};

const kinds = (facts: Partial<CardFacts>): string[] =>
  cardMarks({ ...READY, ...facts }).map(({ kind }) => kind);

describe("cardMarks", () => {
  it("shows nothing for a state its column names already", () => {
    expect(kinds({ state: "ready" })).toEqual([]);
    expect(kinds({ state: "in-progress" })).toEqual([]);
    expect(kinds({ state: "done" })).toEqual([]);
  });

  it("puts what needs the user first, then what holds it, the quiet ones, then who works on it", () => {
    expect(
      kinds({
        state: "paused",
        waiting: true,
        blockers: 3,
        queued: true,
        hasUsageEstimate: true,
        someoneWorking: true,
      }),
    ).toEqual(["waiting-on-you", "paused", "blocked", "queued", "usage-estimate", "working"]);
  });

  it("shows the current Stage on a started Task, with nobody working, between runs too", () => {
    expect(kinds({ state: "in-progress", atStage: true })).toEqual(["working"]);
    expect(kinds({ state: "waiting-on-you", atStage: true })).toEqual([
      "waiting-on-you",
      "working",
    ]);
    expect(kinds({ state: "paused", waiting: true, atStage: true })).toEqual([
      "waiting-on-you",
      "paused",
      "working",
    ]);
  });

  it("shows no Stage on a Task that isn't started", () => {
    expect(kinds({ state: "done", atStage: true })).toEqual([]);
    expect(kinds({ state: "dropped", atStage: true })).toEqual(["dropped"]);
    expect(kinds({ state: "ready", atStage: true })).toEqual([]);
  });

  it("counts the blockers", () => {
    expect(cardMarks({ ...READY, blockers: 2 })).toEqual([{ kind: "blocked", count: 2 }]);
  });

  it("shows Planning, or Waiting on you in its place while a Decision is open", () => {
    expect(kinds({ state: "planning" })).toEqual(["planning"]);
    expect(kinds({ state: "planning", waiting: true })).toEqual(["waiting-on-you"]);
  });

  it("shows Waiting on you and Dropped by their states", () => {
    expect(kinds({ state: "waiting-on-you" })).toEqual(["waiting-on-you"]);
    expect(kinds({ state: "dropped" })).toEqual(["dropped"]);
  });

  it("offers Plan in Backlog only while someone is the Planner", () => {
    expect(kinds({ state: "backlog" })).toEqual(["plan"]);
    expect(kinds({ state: "backlog", hasPlanner: false })).toEqual([]);
    expect(kinds({ state: "ready" })).not.toContain("plan");
  });
});
