import * as React from 'react';
export interface AlertProps{tone?: 'neutral'|'info'|'success'|'warning'|'danger';title?: React.ReactNode;children?: React.ReactNode;/** inline button/link on the right */action?: React.ReactNode;onClose?: () => void;style?: React.CSSProperties;}
export declare function Alert(props: AlertProps): JSX.Element;
