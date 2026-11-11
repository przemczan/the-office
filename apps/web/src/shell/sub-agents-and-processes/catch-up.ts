/** A Process's output chunk or a Sub-agent's message: numbered in the order it came. */
export interface Sequenced {
  readonly sequence: number;
}

/**
 * What a page holds of a stream it opened late (spec 2.9, "A page that opens late"): the parts in
 * order, up to `lastSequence`, and, while a read is under way, the live parts held for when it
 * answers.
 */
export interface CaughtUp<Part extends Sequenced> {
  readonly parts: readonly Part[];
  readonly lastSequence: number;
  /** Undefined unless a read is under way. */
  readonly held: readonly Part[] | undefined;
}

/** The state after a part or a read, and the sequence to read again after when one was missed. */
export interface CatchUpStep<Part extends Sequenced> {
  readonly state: CaughtUp<Part>;
  readonly readAfter?: number;
}

/** Nothing yet, the first read under way: the page subscribes, then reads everything kept. */
export function startingToRead<Part extends Sequenced>(): CaughtUp<Part> {
  return { parts: [], lastSequence: 0, held: [] };
}

/** A read again from the last sequence held, as after a reconnect; live parts are held meanwhile. */
export function readingAgain<Part extends Sequenced>(state: CaughtUp<Part>): CaughtUp<Part> {
  return state.held === undefined ? { ...state, held: [] } : state;
}

/**
 * A live part: held while a read is under way; otherwise dropped when the parts already reach it,
 * applied when it is the next one, and, when it skips ahead, held while the missed ones are read.
 */
export function withPart<Part extends Sequenced>(
  state: CaughtUp<Part>,
  part: Part,
): CatchUpStep<Part> {
  if (state.held !== undefined) return { state: { ...state, held: heldWith(state.held, part) } };
  if (part.sequence <= state.lastSequence) return { state };
  if (part.sequence === state.lastSequence + 1) {
    return { state: { ...state, parts: [...state.parts, part], lastSequence: part.sequence } };
  }
  return { state: { ...state, held: [part] }, readAfter: state.lastSequence };
}

/**
 * A read's answer: what it has after the parts held, then the live parts held meanwhile that come
 * after it; one at or before the read's last sequence is already in it.
 */
export function withRead<Part extends Sequenced>(
  state: CaughtUp<Part>,
  read: { readonly parts: readonly Part[]; readonly lastSequence: number },
): CatchUpStep<Part> {
  const held = state.held ?? [];
  let caughtUp: CaughtUp<Part> = {
    parts: [...state.parts, ...read.parts.filter(({ sequence }) => sequence > state.lastSequence)],
    lastSequence: Math.max(state.lastSequence, read.lastSequence),
    held: undefined,
  };
  for (const [index, part] of held.entries()) {
    const step = withPart(caughtUp, part);
    if (step.readAfter !== undefined) {
      const stillHeld = held.slice(index + 1).reduce(heldWith, step.state.held ?? []);
      return { state: { ...step.state, held: stillHeld }, readAfter: step.readAfter };
    }
    caughtUp = step.state;
  }
  return { state: caughtUp };
}

/** The held parts in order, each sequence once. */
function heldWith<Part extends Sequenced>(held: readonly Part[], part: Part): readonly Part[] {
  if (held.some(({ sequence }) => sequence === part.sequence)) return held;
  return [...held, part].toSorted((first, second) => first.sequence - second.sequence);
}
