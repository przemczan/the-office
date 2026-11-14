import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";

/** An account card's title: its icon, then its name. */
export function AccountCardTitle({
  icon,
  children,
}: {
  readonly icon: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <span className="account-block-title">
      <Icon name={icon} size={15} strokeWidth={1.6} />
      {children}
    </span>
  );
}
