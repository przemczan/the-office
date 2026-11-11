import { describe, expect, it } from "vitest";
import {
  readingAgain,
  startingToRead,
  withPart,
  withRead,
  type CaughtUp,
  type Sequenced,
} from "./catch-up.ts";

interface Chunk extends Sequenced {
  readonly text: string;
}

const chunk = (sequence: number): Chunk => ({ sequence, text: `line ${sequence}\n` });
const chunks = (...sequences: number[]): Chunk[] => sequences.map(chunk);
const sequencesOf = (state: CaughtUp<Chunk>): number[] => state.parts.map((part) => part.sequence);

function live(...sequences: number[]): CaughtUp<Chunk> {
  return { parts: chunks(...sequences), lastSequence: sequences.at(-1) ?? 0, held: undefined };
}

describe("catching up a stream opened late", () => {
  it("applies the read, then each live part in order", () => {
    const read = withRead(startingToRead<Chunk>(), { parts: chunks(1, 2, 3), lastSequence: 3 });
    expect(read.readAfter).toBeUndefined();
    const next = withPart(read.state, chunk(4));
    expect(sequencesOf(next.state)).toEqual([1, 2, 3, 4]);
    expect(next.state.lastSequence).toBe(4);
  });

  it("holds what arrives before the read answers, and applies only what comes after it", () => {
    let state = startingToRead<Chunk>();
    state = withPart(state, chunk(3)).state;
    state = withPart(state, chunk(5)).state;
    state = withPart(state, chunk(4)).state;
    expect(state.parts).toEqual([]);
    const read = withRead(state, { parts: chunks(1, 2, 3), lastSequence: 3 });
    expect(read.readAfter).toBeUndefined();
    expect(sequencesOf(read.state)).toEqual([1, 2, 3, 4, 5]);
    expect(read.state.held).toBeUndefined();
  });

  it("drops a part it already has", () => {
    const state = live(1, 2, 3);
    expect(withPart(state, chunk(2)).state).toBe(state);
    expect(withPart(state, chunk(3)).state).toBe(state);
  });

  it("drops a held part twice over", () => {
    let state = startingToRead<Chunk>();
    state = withPart(state, chunk(2)).state;
    state = withPart(state, chunk(2)).state;
    const read = withRead(state, { parts: chunks(1), lastSequence: 1 });
    expect(sequencesOf(read.state)).toEqual([1, 2]);
  });

  it("reads again from the last sequence on a gap, holding what comes meanwhile", () => {
    const gap = withPart(live(1, 2), chunk(5));
    expect(gap.readAfter).toBe(2);
    const meanwhile = withPart(gap.state, chunk(6));
    expect(meanwhile.readAfter).toBeUndefined();
    const read = withRead(meanwhile.state, { parts: chunks(3, 4, 5), lastSequence: 5 });
    expect(read.readAfter).toBeUndefined();
    expect(sequencesOf(read.state)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("reads again when what was held still skips ahead of the read", () => {
    let state = startingToRead<Chunk>();
    state = withPart(state, chunk(5)).state;
    state = withPart(state, chunk(6)).state;
    const read = withRead(state, { parts: chunks(1, 2), lastSequence: 2 });
    expect(read.readAfter).toBe(2);
    expect(sequencesOf(read.state)).toEqual([1, 2]);
    expect(read.state.held?.map(({ sequence }) => sequence)).toEqual([5, 6]);
  });

  it("reads again after a reconnect from what it has, keeping it", () => {
    const state = readingAgain(live(1, 2));
    const held = withPart(state, chunk(4)).state;
    const read = withRead(held, { parts: chunks(3), lastSequence: 3 });
    expect(sequencesOf(read.state)).toEqual([1, 2, 3, 4]);
  });

  it("takes a read that starts after earlier output was dropped", () => {
    const read = withRead(startingToRead<Chunk>(), { parts: chunks(40, 41), lastSequence: 41 });
    expect(sequencesOf(withPart(read.state, chunk(42)).state)).toEqual([40, 41, 42]);
  });
});
