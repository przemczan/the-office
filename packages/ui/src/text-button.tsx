import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * A button that reads as a link among words, where the design system's Button, a control of its own
 * height, would break the line. design-system/ stays as it is, hence this here.
 */
export function TextButton({
  className,
  children,
  ...button
}: ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      type="button"
      className={className === undefined ? "text-button" : `text-button ${className}`}
      {...button}
    >
      {children}
    </button>
  );
}
