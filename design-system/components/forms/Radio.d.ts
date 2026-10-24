import * as React from 'react';
export interface RadioProps{checked?: boolean;onChange?: (checked: boolean) => void;label?: React.ReactNode;description?: React.ReactNode;disabled?: boolean;style?: React.CSSProperties;}
export declare function Radio(props: RadioProps): JSX.Element;
export interface RadioGroupOption{value: string;label: React.ReactNode;description?: React.ReactNode;disabled?: boolean;}
export interface RadioGroupProps{options?: RadioGroupOption[];value?: string;onChange?: (value: string) => void;direction?: 'row'|'column';style?: React.CSSProperties;}
export declare function RadioGroup(props: RadioGroupProps): JSX.Element;
