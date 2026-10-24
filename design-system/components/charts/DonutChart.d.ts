import * as React from 'react';
export interface DonutDatum{label: string;value: number;color?: string;}
export interface DonutChartProps{
  /** ≤6 slices; group the rest into "Other" */
  data?: DonutDatum[];
  size?: number;
  thickness?: number;
  centerValue?: React.ReactNode;
  centerLabel?: React.ReactNode;
  showLegend?: boolean;
  valueFormat?: (v: number) => string;
  style?: React.CSSProperties;
}
export declare function DonutChart(props: DonutChartProps): JSX.Element;
