import { Icon, Tooltip } from "@the-office/ui";
import type { ReactElement, ReactNode } from "react";
import { useRailExpansion } from "./rail-store.ts";

/** A rail item's icon, with its label beside it while the rail is expanded. */
export function RailItemFace({
  icon,
  label,
}: {
  readonly icon: string;
  readonly label: string;
}): ReactNode {
  const { expanded } = useRailExpansion();
  return (
    <>
      <Icon name={icon} size={18} strokeWidth={1.6} />
      {expanded && <span className="shell-rail-label">{label}</span>}
    </>
  );
}

/** The item's label beside the icon rail; the expanded rail shows it already. */
export function RailItemTooltip({
  label,
  open,
  children,
}: {
  readonly label: string;
  readonly open?: boolean;
  readonly children: ReactElement;
}): ReactNode {
  const { expanded } = useRailExpansion();
  if (expanded) return children;
  return (
    <Tooltip content={label} side="right" open={open}>
      {children}
    </Tooltip>
  );
}
