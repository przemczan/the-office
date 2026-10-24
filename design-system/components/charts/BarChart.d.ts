import * as React from 'react';
export interface BarSeries{name: string;data: number[];color?: string;}
export interface BarChartProps{
  labels?: string[];
  series?: BarSeries[];
  /** stack series instead of grouping side by side */
  stacked?: boolean;
  height?: number;
  yFormat?: (v: number) => string;
  showLegend?: boolean;
  yTicks?: number;
  style?: React.CSSProperties;
}
export declare function BarChart(props: BarChartProps): JSX.Element;
