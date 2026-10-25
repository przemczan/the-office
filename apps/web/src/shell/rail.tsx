import { Link, type LinkProps } from "@tanstack/react-router";
import { Icon, Logo, Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { useBrandTone } from "./brand-tone.ts";
import { PaletteMenu } from "./palette-menu.tsx";

interface Surface {
  readonly to: NonNullable<LinkProps["to"]>;
  readonly label: string;
  readonly icon: string;
}

const SURFACES: readonly Surface[] = [
  { to: "/now", label: "Now", icon: "inbox" },
  { to: "/work", label: "Work", icon: "kanban" },
  { to: "/people", label: "People", icon: "users" },
  { to: "/projects", label: "Projects", icon: "folder-git-2" },
];

const SETTINGS: Surface = { to: "/settings", label: "Settings", icon: "settings-2" };

/** The icon rail: the mark, the surfaces, then Settings and the palette at its foot. */
export function Rail(): ReactNode {
  return (
    <nav className="shell-rail" aria-label="Surfaces">
      <Link to="/now" className="shell-rail-mark" aria-label="The Office">
        <Logo variant="mark" size={30} tone={useBrandTone()} />
      </Link>
      {SURFACES.map((surface) => (
        <RailLink key={surface.to} surface={surface} />
      ))}
      <span className="shell-rail-spacer" />
      <RailLink surface={SETTINGS} />
      <PaletteMenu />
    </nav>
  );
}

function RailLink({ surface }: { readonly surface: Surface }): ReactNode {
  return (
    <Tooltip content={surface.label} side="right">
      <Link
        to={surface.to}
        className="shell-rail-item"
        activeProps={{ className: "active", "aria-current": "page" }}
        aria-label={surface.label}
      >
        <Icon name={surface.icon} size={18} strokeWidth={1.6} />
      </Link>
    </Tooltip>
  );
}
