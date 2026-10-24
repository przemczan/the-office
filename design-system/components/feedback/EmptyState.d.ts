import * as React from 'react';
export interface EmptyStateProps{/** Lucide name */icon?: string;title: React.ReactNode;description?: React.ReactNode;action?: React.ReactNode;compact?: boolean;style?: React.CSSProperties;}
export declare function EmptyState(props: EmptyStateProps): JSX.Element;
