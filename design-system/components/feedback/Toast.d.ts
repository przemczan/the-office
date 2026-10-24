import * as React from 'react';
/**
 * Transient notification, bottom-right stack. Also Alert, EmptyState, Skeleton.
 * @startingPoint section="Feedback" subtitle="Toast, alert, empty state, skeleton" viewport="700x380"
 */
export interface ToastProps{tone?: 'neutral'|'info'|'success'|'warning'|'danger';title?: React.ReactNode;description?: React.ReactNode;/** e.g. Undo button */action?: React.ReactNode;onClose?: () => void;style?: React.CSSProperties;}
export declare function Toast(props: ToastProps): JSX.Element;
