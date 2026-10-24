import * as React from 'react';
export interface PageHeaderProps{
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned buttons — at most one primary */
  actions?: React.ReactNode;
  /** Inline after the title — status Badge, ID */
  meta?: React.ReactNode;
  /** Above the title — back link or Breadcrumbs */
  eyebrow?: React.ReactNode;
  /** Below — usually Tabs */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function PageHeader(props: PageHeaderProps): JSX.Element;
