import * as React from 'react';
export interface ChartSeries{name: string;data: number[];/** CSS colour; defaults to --chart-1…6 in order */color?: string;/** dashed line — use for "previous period" */dashed?: boolean;}
/**
 * Responsive line/area chart with hover crosshair tooltip. Also see BarChart, DonutChart, Sparkline.
 * @startingPoint section="Data" subtitle="Line, bar, donut charts and sparklines" viewport="700x460"
 */
export interface LineChartProps{
  /** x-axis labels, one per data point */
  labels?: string[];
  series?: ChartSeries[];
  height?: number;
  /** y-axis + tooltip formatter. Default abbreviates (12.4k) */
  yFormat?: (v: number) => string;
  /** filled area under lines — defaults to true when a single series */
  showArea?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  yTicks?: number;
  style?: React.CSSProperties;
}
export declare function LineChart(props: LineChartProps): JSX.Element;
