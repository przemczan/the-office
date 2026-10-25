import type { RoleCard } from "./role-card.js";
import type { RoleCardFieldChange } from "./role-card-changes.js";

/** A job the user hired for, filled by the one person its card names. */
export interface Role {
  /** Kept from the preset it was hired from, as Pipelines and Consult values name it. */
  readonly key: string;
  readonly card: RoleCard;
  /**
   * Counts the card's saved versions, from 1. A session records the version it started with, and a
   * change reaches only sessions started after it (spec §2.2).
   */
  readonly cardVersion: number;
  readonly hiredAt: Date;
  /** When the current version was saved. */
  readonly cardSavedAt: Date;
}

/** A saved version of a Role card, with what changed from the version before: nothing for the first. */
export interface RoleCardVersion {
  readonly version: number;
  readonly card: RoleCard;
  readonly changes: readonly RoleCardFieldChange[];
  readonly savedAt: Date;
}
