import type { BadgeProps } from "@the-office/ui";

export type Tone = NonNullable<BadgeProps["tone"]>;

/** A status as a badge: its label, the badge's tone and what it means. */
export interface ToneWords {
  readonly label: string;
  readonly tone: Tone;
  /** What the label means, on hover. */
  readonly title: string;
}
