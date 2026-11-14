/*
 * The duties Work's built-in behaviour turns to, by the keys People keeps them under (spec §2.2,
 * "Duties"): whoever holds one does its job, whatever their Role key, and nobody does it while it
 * is unheld.
 */

/** Shapes Initiatives: the person an Initiative's shaping Thread is with. */
export const SHAPES_INITIATIVES = "shapes-initiatives";

/** Plans: the person Make a plan and Plan the Initiative open their Thread with. */
export const PLANS = "plans";

/** Why shaping is refused while nobody holds Shapes Initiatives. */
export const NOBODY_SHAPES_INITIATIVES =
  "Nobody holds Shapes Initiatives: choose who in Settings › Duties first, as shaping is a conversation with them.";

/** Why planning with someone is refused while nobody holds Plans; planning by hand still works. */
export const NOBODY_PLANS =
  "Nobody holds Plans: choose who in Settings › Duties first, as planning is a conversation with them, or write the Plan and the Definition of Done yourself.";
