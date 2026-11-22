// The design system's Card pads its parts with fixed sizes, and design-system/ stays as it is.
// So this Card keeps its frame (the variants' surface, border, corner and shadow) and draws the
// header, body and footer itself, padded by the density's card aliases like every other card.
import type { JSX } from "react";
import {
  Card as DesignSystemCard,
  type CardProps,
} from "../../../design-system/components/core/Card.jsx";

/** Lets the parts below be the frame's own: the frame's body wrapper takes no box. */
const FRAME_BODY = { display: "contents" } as const;

export function Card({
  title,
  subtitle,
  actions,
  footer,
  variant,
  padding = "md",
  children,
  style,
  bodyStyle,
}: CardProps): JSX.Element {
  const edgeToEdge = padding === "none";
  // As the design system's Card: a header only for a title or actions given.
  const head = Boolean(title) || Boolean(actions);
  return (
    <DesignSystemCard variant={variant} padding="none" style={style} bodyStyle={FRAME_BODY}>
      {head && (
        <header className="card-head" data-edge-to-edge={edgeToEdge || undefined}>
          <div className="card-head-text">
            {Boolean(title) && <h3>{title}</h3>}
            {Boolean(subtitle) && <p>{subtitle}</p>}
          </div>
          {Boolean(actions) && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div
        className="card-body"
        data-edge-to-edge={edgeToEdge || undefined}
        data-under-head={head || undefined}
        style={bodyStyle}
      >
        {children}
      </div>
      {Boolean(footer) && <footer className="card-foot">{footer}</footer>}
    </DesignSystemCard>
  );
}
