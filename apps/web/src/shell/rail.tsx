import { Link, useRouterState, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useBrandTone } from "./brand-tone.ts";
import { OfficeMark } from "./office-mark.tsx";
import { ThemeMenu } from "./theme-menu.tsx";
import { RailItemFace, RailItemTooltip } from "./rail-item.tsx";
import { useRailExpansion } from "./rail-store.ts";

interface Surface {
  readonly to: NonNullable<LinkProps["to"]>;
  readonly label: string;
  readonly icon: string;
  /** Pages outside its path that belong to it, by the start of their path. */
  readonly alsoOn?: readonly string[];
}

const SURFACES: readonly Surface[] = [
  { to: "/now", label: "Now", icon: "inbox" },
  { to: "/work", label: "Work", icon: "kanban", alsoOn: ["/tasks/"] },
  { to: "/projects", label: "Projects", icon: "folder-git-2" },
  { to: "/people", label: "People", icon: "users" },
  { to: "/stats", label: "Stats", icon: "chart-column" },
  { to: "/live-view", label: "Live view", icon: "building-2" },
];

const SETTINGS: Surface = { to: "/settings", label: "Settings", icon: "settings-2" };

const RAIL_ID = "shell-rail";

/**
 * The rail: the mark, the surfaces, then Settings, the palette and the toggle at its foot. Icons
 * only until the user expands it to show the labels too.
 */
export function Rail(): ReactNode {
  const { expanded } = useRailExpansion();
  return (
    <nav id={RAIL_ID} className="shell-rail" aria-label="Surfaces" data-expanded={expanded}>
      <Link to="/now" className="shell-rail-mark" aria-label="The Office">
        <OfficeMark size={30} tone={useBrandTone()} />
        {expanded && <span className="shell-rail-name">The Office</span>}
      </Link>
      {SURFACES.map((surface) => (
        <RailLink key={surface.to} surface={surface} />
      ))}
      <span className="shell-rail-spacer" />
      <RailLink surface={SETTINGS} />
      <ThemeMenu />
      <RailToggle />
    </nav>
  );
}

function RailLink({ surface }: { readonly surface: Surface }): ReactNode {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const alsoActive = surface.alsoOn?.some((start) => pathname.startsWith(start)) ?? false;
  return (
    <RailItemTooltip label={surface.label}>
      <Link
        to={surface.to}
        className={alsoActive ? "shell-rail-item active" : "shell-rail-item"}
        aria-current={alsoActive ? "page" : undefined}
        activeProps={{ className: "active", "aria-current": "page" }}
        aria-label={surface.label}
      >
        <RailItemFace icon={surface.icon} label={surface.label} />
      </Link>
    </RailItemTooltip>
  );
}

function RailToggle(): ReactNode {
  const { expanded, toggle } = useRailExpansion();
  const label = expanded ? "Collapse sidebar" : "Expand sidebar";
  return (
    <RailItemTooltip label={label}>
      <button
        type="button"
        className="shell-rail-item shell-rail-toggle"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={RAIL_ID}
        onClick={toggle}
      >
        <RailItemFace icon={expanded ? "panel-left-close" : "panel-left-open"} label={label} />
      </button>
    </RailItemTooltip>
  );
}
