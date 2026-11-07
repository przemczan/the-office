import type { Avatar } from "./avatar.js";
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
  /**
   * Who proposed the current version, by the key of their Role, when the user applied a Proposal;
   * undefined when the user wrote it themselves.
   */
  readonly cardProposedBy: string | undefined;
  /**
   * When the user let the person go; undefined while they fill the Role. A person let go keeps
   * their card, Memory and chats, unused and readable, until hired back (spec §2.2).
   */
  readonly letGoAt: Date | undefined;
  /** The person's own picture, or null: it sits beside the card, in none of its versions. */
  readonly avatar: Avatar | null;
}

/** A saved version of a Role card, with what changed from the version before: nothing for the first. */
export interface RoleCardVersion {
  readonly version: number;
  readonly card: RoleCard;
  readonly changes: readonly RoleCardFieldChange[];
  readonly savedAt: Date;
  /** Who proposed it, by the key of their Role; undefined when the user wrote it themselves. */
  readonly proposedBy: string | undefined;
}
