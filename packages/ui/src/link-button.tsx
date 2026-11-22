import type { AnchorHTMLAttributes, ReactNode } from "react";

/**
 * A link that looks like the design system's secondary Button, whose `<button>` can't take an href:
 * middle-click and copying the link work. design-system/ stays as it is, hence this here.
 */
export function LinkButton({
  children,
  ...anchor
}: AnchorHTMLAttributes<HTMLAnchorElement> & { readonly href: string }): ReactNode {
  return (
    <a className="link-button" {...anchor}>
      {children}
    </a>
  );
}
