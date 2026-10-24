import * as React from 'react';
export interface TimelineItem{
  id?: string|number;
  /** bold lead-in, e.g. "Marta Kowalska" */
  actor?: React.ReactNode;
  /** event text after the actor, e.g. "changed role to Admin" */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** pre-formatted, e.g. "14:02" or "2h ago" */
  time?: React.ReactNode;
  /** Lucide name in the node; ignored if avatar given */
  icon?: string;
  avatar?: React.ReactNode;
  tone?: 'neutral'|'accent'|'success'|'warning'|'danger'|'info';
  /** extra block — diff, code, tags */
  meta?: React.ReactNode;
}
export interface TimelineProps{items?: TimelineItem[];style?: React.CSSProperties;}
export declare function Timeline(props: TimelineProps): JSX.Element;
