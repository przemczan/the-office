import type { QueuedTask, Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  BLOCK_REFUSAL,
  blockCount,
  blockDropRefusal,
  cardsOfBlock,
  columnBlocks,
  LOOSE_REFUSAL,
  type ColumnItem,
} from "./board-blocks.ts";
import { cardsIn, COLUMNS, type Column } from "./board-columns.ts";
import { NO_INITIATIVE } from "./board-groups.ts";

function aTask(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    projectId: "firmware",
    priority: "normal",
    tags: [],
    state: "backlog",
    plan: "",
    pausedBy: null,
    engineStandIns: [],
    resumesAt: null,
    autoMode: false,
    initiativePlanningThreadId: null,
    markedPlanned: false,
    hasPlanningThread: false,
    planConfirmed: false,
    filesToChange: [],
    estimatedTokens: null,
    definitionOfDone: [],
    definitionOfDoneConfirmed: false,
    commitMessage: "Commit message",
    commitMessageWritten: false,
    commitMessagePublishedAt: null,
    pipelineId: "full",
    proposedPipeline: null,
    blockedBy: [],
    originIdeaId: null,
    initiativeId: null,
    madeFor: null,
    projectMoves: [],
    createdBy: { kind: "user", user: null },
    createdAt: "2026-10-28T10:00:00.000Z",
    archivedAt: null,
    endedAt: null,
    pullRequestEnd: null,
    ...fields,
  };
}

function queued(taskId: string, place: number): QueuedTask {
  return {
    taskId,
    place,
    queuedAt: "2026-11-14T09:00:00.000Z",
    reasons: [],
    shortReasons: [],
    behind: [],
  };
}

function column(key: string): Column {
  const found = COLUMNS.find((each) => each.key === key);
  if (!found) throw new Error(`No column ${key}`);
  return found;
}

/** Each item as its block's id and cards' ids, or the loose card's id. */
function shape(items: readonly ColumnItem[]): (string | readonly [string, string[]])[] {
  return items.map((item) =>
    item.kind === "loose" ? item.card.id : [item.initiativeId, item.cards.map(({ id }) => id)],
  );
}

/** A block for the Initiative "sync" alone, as for an Initiative not read. */
function onlySync(card: Task): string {
  return card.initiativeId === "sync" ? "sync" : NO_INITIATIVE;
}

describe("columnBlocks", () => {
  it("places a block at its first card and gathers a later card of its Initiative into it", () => {
    const cards = [
      aTask("sync-1", { initiativeId: "sync" }),
      aTask("loose-1"),
      aTask("sync-2", { initiativeId: "sync" }),
    ];

    expect(shape(columnBlocks(cards))).toEqual([["sync", ["sync-1", "sync-2"]], "loose-1"]);
  });

  it("keeps loose cards in their place between the blocks", () => {
    const cards = [
      aTask("loose-1"),
      aTask("sync-1", { initiativeId: "sync" }),
      aTask("loose-2"),
      aTask("pair-1", { initiativeId: "pairing" }),
      aTask("loose-3"),
      aTask("sync-2", { initiativeId: "sync" }),
    ];

    expect(shape(columnBlocks(cards))).toEqual([
      "loose-1",
      ["sync", ["sync-1", "sync-2"]],
      "loose-2",
      ["pairing", ["pair-1"]],
      "loose-3",
    ]);
  });

  it("makes a block of one card", () => {
    expect(shape(columnBlocks([aTask("sync-1", { initiativeId: "sync" })]))).toEqual([
      ["sync", ["sync-1"]],
    ]);
  });

  it("keeps Queued's order by place inside and between the blocks", () => {
    const tasks = [
      aTask("sync-1", { initiativeId: "sync", state: "ready" }),
      aTask("pair-1", { initiativeId: "pairing", state: "ready" }),
      aTask("sync-2", { initiativeId: "sync", state: "ready" }),
      aTask("loose-1", { state: "ready" }),
    ];
    const queue = [
      queued("pair-1", 1),
      queued("sync-2", 2),
      queued("loose-1", 3),
      queued("sync-1", 4),
    ];

    expect(shape(columnBlocks(cardsIn(column("queued"), tasks, queue)))).toEqual([
      ["pairing", ["pair-1"]],
      ["sync", ["sync-2", "sync-1"]],
      "loose-1",
    ]);
  });

  it("keeps Done's order, the one that ended last first, inside and between the blocks", () => {
    const tasks = [
      aTask("sync-1", { initiativeId: "sync", state: "done", endedAt: "2026-11-01T10:00:00.000Z" }),
      aTask("loose-1", { state: "done", endedAt: "2026-11-05T10:00:00.000Z" }),
      aTask("sync-2", {
        initiativeId: "sync",
        state: "dropped",
        endedAt: "2026-11-03T10:00:00.000Z",
      }),
      aTask("pair-1", {
        initiativeId: "pairing",
        state: "done",
        endedAt: "2026-11-02T10:00:00.000Z",
      }),
    ];

    expect(shape(columnBlocks(cardsIn(column("done"), tasks, [])))).toEqual([
      "loose-1",
      ["sync", ["sync-2", "sync-1"]],
      ["pairing", ["pair-1"]],
    ]);
  });

  it("leaves a column with no Initiative's card loose", () => {
    expect(shape(columnBlocks([aTask("loose-1"), aTask("loose-2")]))).toEqual([
      "loose-1",
      "loose-2",
    ]);
  });

  it("makes one block of a column whose every card is one Initiative's", () => {
    const cards = ["sync-1", "sync-2", "sync-3"].map((id) => aTask(id, { initiativeId: "sync" }));

    expect(shape(columnBlocks(cards))).toEqual([["sync", ["sync-1", "sync-2", "sync-3"]]]);
  });

  it("leaves loose a card its `blockOf` puts in no block", () => {
    const cards = [
      aTask("sync-1", { initiativeId: "sync" }),
      aTask("gone-1", { initiativeId: "gone" }),
    ];
    expect(shape(columnBlocks(cards, onlySync))).toEqual([["sync", ["sync-1"]], "gone-1"]);
  });
});

describe("cardsOfBlock", () => {
  const items = columnBlocks([
    aTask("loose-1"),
    aTask("sync-1", { initiativeId: "sync" }),
    aTask("loose-2"),
    aTask("sync-2", { initiativeId: "sync" }),
  ]);

  it("gives a block's cards", () => {
    expect(cardsOfBlock(items, "sync").map(({ id }) => id)).toEqual(["sync-1", "sync-2"]);
  });

  it("gives the loose cards for no Initiative", () => {
    expect(cardsOfBlock(items, NO_INITIATIVE).map(({ id }) => id)).toEqual(["loose-1", "loose-2"]);
  });
});

describe("blockDropRefusal", () => {
  it("takes a drop within the card's own block, or among the loose cards", () => {
    expect(blockDropRefusal("sync", "sync")).toBeUndefined();
    expect(blockDropRefusal(NO_INITIATIVE, NO_INITIATIVE)).toBeUndefined();
  });

  it("refuses a block's card dropped over another block or among the loose cards", () => {
    expect(blockDropRefusal("sync", "pairing")).toBe(BLOCK_REFUSAL);
    expect(blockDropRefusal("sync", NO_INITIATIVE)).toBe(BLOCK_REFUSAL);
  });

  it("refuses a loose card dropped over a block", () => {
    expect(blockDropRefusal(NO_INITIATIVE, "sync")).toBe(LOOSE_REFUSAL);
  });
});

describe("blockCount", () => {
  it("counts the cards the column shows", () => {
    const cards = [aTask("sync-1", { state: "ready" }), aTask("sync-2", { state: "ready" })];

    expect(blockCount(cards, column("ready"), [])).toEqual({
      shown: "2",
      words: "2 of its Tasks in Ready",
    });
  });

  it("names the places in Queued", () => {
    const cards = [aTask("sync-1", { state: "ready" }), aTask("sync-2", { state: "ready" })];
    const queue = [queued("sync-1", 1), queued("sync-2", 3)];

    expect(blockCount(cards, column("queued"), queue)).toEqual({
      shown: "#1 · #3",
      words: "Places 1 and 3 in the queue",
    });
    expect(blockCount(cards.slice(0, 1), column("queued"), queue)).toEqual({
      shown: "#1",
      words: "Place 1 in the queue",
    });
  });
});
