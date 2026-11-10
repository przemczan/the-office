import { describe, expect, it } from "vitest";
import {
  archiveInitiative,
  archiveInitiativeIfDue,
  initiativeArchivePeriodStart,
  isEndedOnTheBoard,
  restoreInitiative,
} from "./initiative-archive.js";
import { InitiativeArchived, InitiativeRestored } from "./initiative-events.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { archiveCutoff, DEFAULT_ARCHIVE_PERIOD } from "./task-archive.js";
import { anInitiative } from "./work.fixtures.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-09T12:00:00.000Z");
const cutoff = archiveCutoff(now, DEFAULT_ARCHIVE_PERIOD);

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

describe("archiveInitiative", () => {
  it("marks a Done or Dropped Initiative archived, its state untouched", () => {
    for (const state of ["done", "dropped"] as const) {
      const change = archiveInitiative(anInitiative({ state, endedAt: daysAgo(1) }), now);

      expect(change?.initiative).toMatchObject({ state, archivedAt: now });
      expect(change?.event).toBeInstanceOf(InitiativeArchived);
      expect(change?.event).toMatchObject({ initiativeId: "initiative-1", occurredAt: now });
    }
  });

  it("refuses one being shaped or active, saying why", () => {
    expect(() => archiveInitiative(anInitiative({ state: "active" }), now)).toThrow(
      new InitiativeRefused([
        "Only a Done or Dropped Initiative can be archived; this one is active.",
      ]),
    );
    expect(() => archiveInitiative(anInitiative(), now)).toThrow(InitiativeRefused);
  });

  it("changes nothing for one already archived", () => {
    expect(
      archiveInitiative(anInitiative({ state: "done", archivedAt: daysAgo(2) }), now),
    ).toBeUndefined();
  });
});

describe("restoreInitiative", () => {
  it("puts an archived one back on the board, keeping the moment", () => {
    const change = restoreInitiative(
      anInitiative({ state: "dropped", archivedAt: daysAgo(3) }),
      now,
    );

    expect(change?.initiative).toMatchObject({
      state: "dropped",
      archivedAt: undefined,
      restoredAt: now,
    });
    expect(change?.event).toBeInstanceOf(InitiativeRestored);
  });

  it("changes nothing for one on the board", () => {
    expect(restoreInitiative(anInitiative({ state: "done" }), now)).toBeUndefined();
  });
});

describe("initiativeArchivePeriodStart", () => {
  it("is the later of its end and its last Restore", () => {
    expect(initiativeArchivePeriodStart(anInitiative({ endedAt: daysAgo(5) }))).toEqual(daysAgo(5));
    expect(
      initiativeArchivePeriodStart(anInitiative({ endedAt: daysAgo(50), restoredAt: daysAgo(2) })),
    ).toEqual(daysAgo(2));
    expect(
      initiativeArchivePeriodStart(anInitiative({ endedAt: daysAgo(2), restoredAt: daysAgo(50) })),
    ).toEqual(daysAgo(2));
  });

  it("is its Restore alone, or nothing, for one whose end nothing dates", () => {
    expect(initiativeArchivePeriodStart(anInitiative({ restoredAt: daysAgo(4) }))).toEqual(
      daysAgo(4),
    );
    expect(initiativeArchivePeriodStart(anInitiative())).toBeUndefined();
  });
});

describe("archiveInitiativeIfDue", () => {
  it("archives one ended longer ago than the period, and leaves a recent one", () => {
    const old = anInitiative({ state: "done", endedAt: daysAgo(DEFAULT_ARCHIVE_PERIOD + 1) });
    const recent = anInitiative({ state: "dropped", endedAt: daysAgo(DEFAULT_ARCHIVE_PERIOD - 1) });

    expect(archiveInitiativeIfDue(old, cutoff, now)?.initiative.archivedAt).toEqual(now);
    expect(archiveInitiativeIfDue(recent, cutoff, now)).toBeUndefined();
  });

  it("archives at once an ended one nothing dates, unless it was restored since", () => {
    expect(archiveInitiativeIfDue(anInitiative({ state: "dropped" }), cutoff, now)).toBeDefined();
    expect(
      archiveInitiativeIfDue(
        anInitiative({ state: "dropped", restoredAt: daysAgo(1) }),
        cutoff,
        now,
      ),
    ).toBeUndefined();
  });

  it("never archives one being shaped or active, however old, nor one already archived", () => {
    for (const state of ["shaping", "active"] as const) {
      const initiative = anInitiative({ state, createdAt: daysAgo(10 * DEFAULT_ARCHIVE_PERIOD) });
      expect(archiveInitiativeIfDue(initiative, cutoff, now)).toBeUndefined();
    }
    const archived = anInitiative({ state: "done", archivedAt: daysAgo(1) });
    expect(archiveInitiativeIfDue(archived, cutoff, now)).toBeUndefined();
    expect(isEndedOnTheBoard(archived)).toBe(false);
  });
});
