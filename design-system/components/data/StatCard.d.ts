import * as React from 'react';
export interface StatCardProps{
  label: React.ReactNode;
  /** pre-formatted value, e.g. "$48,210" */
  value: React.ReactNode;
  /** change vs comparison period, e.g. 12.4 or -3 */
  delta?: number;
  deltaSuffix?: string;
  /** true when a decrease is good (churn, error rate, latency) */
  invertDelta?: boolean;
  /** e.g. "vs last 30 days" */
  comparison?: React.ReactNode;
  /** sparkline data */
  trend?: number[];
  /** Lucide name */
  icon?: string;
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function StatCard(props: StatCardProps): JSX.Element;
