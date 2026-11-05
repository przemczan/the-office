import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "../../../design-system/components/core/Icon.jsx";

/**
 * The line that folds and unfolds what is under it: a chevron, then what the line says. Where it sits
 * sets its padding. The design system has no disclosure, hence this here.
 */
export function FoldButton({
  unfolded,
  className,
  children,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly unfolded: boolean }): ReactNode {
  return (
    <button
      type="button"
      className={className === undefined ? "fold-button" : `fold-button ${className}`}
      aria-expanded={unfolded}
      {...button}
    >
      <Icon name="chevron-right" size={14} />
      {children}
    </button>
  );
}
