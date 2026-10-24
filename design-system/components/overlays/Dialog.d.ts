import * as React from 'react';
/**
 * Modal dialog for confirmations and short forms. Footer actions sit on a sunken strip.
 * @startingPoint section="Overlays" subtitle="Dialog, drawer, menu, tooltip" viewport="700x420"
 */
export interface DialogProps{
  open?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** footer buttons, right-aligned: secondary first, primary/danger last */
  actions?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  /** danger adds a warning glyph — destructive confirmations */
  tone?: 'danger';
  /** render without overlay (docs/cards) */
  inline?: boolean;
}
export declare function Dialog(props: DialogProps): JSX.Element|null;
