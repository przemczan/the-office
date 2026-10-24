import * as React from 'react';
export interface TooltipProps{content: React.ReactNode;side?: 'top'|'bottom'|'left'|'right';children: React.ReactNode;/** force open (docs) */open?: boolean;}
export declare function Tooltip(props: TooltipProps): JSX.Element;
