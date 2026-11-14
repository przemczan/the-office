import type { ReactNode } from "react";

/** What a figure does on a press: opens something, or nothing at all. */
export type StripFigureAction =
  | {
      readonly kind: "button";
      readonly onClick: () => void;
      /** What a screen reader says for it, the whole figure in words. */
      readonly name: string;
      /** Whether what it opens is open, for a figure that opens a list or a panel. */
      readonly expanded?: boolean;
    }
  | { readonly kind: "text"; readonly title?: string };

/**
 * One figure of the status strip (docs/design/status-strip.html): a small label over its value,
 * so a figure is as wide as its longer line. A figure that opens something is a button and lights
 * up on hover; one that opens nothing stays plain.
 */
export function StripFigure({
  label,
  value,
  action,
  className,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly action: StripFigureAction;
  readonly className?: string;
}): ReactNode {
  const classes = className ? `shell-strip-figure ${className}` : "shell-strip-figure";
  const parts = (
    <>
      <span className="shell-strip-label">{label}</span>
      <span className="shell-strip-value">{value}</span>
    </>
  );
  if (action.kind === "text") {
    return (
      <span className={`${classes} static`} title={action.title}>
        {parts}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      aria-label={action.name}
      aria-haspopup="dialog"
      aria-expanded={action.expanded}
      onClick={action.onClick}
    >
      {parts}
    </button>
  );
}

/** A label's words that a strip under 600px wide trades for shorter ones: "Desks in use", "Desks". */
export function StripLabel({
  long,
  short,
}: {
  readonly long: string;
  readonly short: string;
}): ReactNode {
  return (
    <>
      <span className="shell-strip-long">{long}</span>
      <span className="shell-strip-short">{short}</span>
    </>
  );
}
