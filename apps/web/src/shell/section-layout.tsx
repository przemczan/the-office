import { Link, type LinkProps } from "@tanstack/react-router";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import "./section-layout.css";

export interface MenuSection {
  readonly to: NonNullable<LinkProps["to"]>;
  /** What this section's address leaves open, when it isn't the layout's `params`. */
  readonly params?: LinkProps["params"];
  /** Tells apart sections that share an address and differ by their `params`. */
  readonly key?: string;
  readonly icon?: string;
  /** In place of the icon, such as a Project's Logo. */
  readonly leading?: ReactNode;
  readonly label: string;
  /** At the item's far end, such as a badge. */
  readonly trailing?: ReactNode;
  /** For a section at its parent's own address, which every other section's address starts with. */
  readonly onlyAtItsAddress?: boolean;
}

/**
 * How the layout folds on a narrow page: `row` puts the menu in a row above the open section;
 * `list-or-open` shows the menu alone while nothing is open, else the open item alone with a link
 * back to the menu.
 */
export type SectionLayoutNarrow = "row" | "list-or-open";

interface SectionLayoutProps {
  /** Names the menu for screen readers. */
  readonly label: string;
  readonly sections: readonly MenuSection[];
  /** What the sections' addresses leave open, such as the Project's id. */
  readonly params?: LinkProps["params"];
  /** `large`: taller items, for a list of records such as the Projects. */
  readonly size?: "default" | "large";
  /** Under the menu, such as a way to add an item. */
  readonly foot?: ReactNode;
  readonly narrow?: SectionLayoutNarrow;
  /** With `list-or-open`: an item is open, so a narrow page shows it alone. */
  readonly showingOpen?: boolean;
  /** With `list-or-open`: the link back to the menu, shown above the open item on a narrow page. */
  readonly back?: { readonly label: string; readonly to: NonNullable<LinkProps["to"]> };
  /** The open section. */
  readonly children: ReactNode;
}

/** A page of sections, each with its own address: the left-hand menu beside the open one. */
export function SectionLayout({
  label,
  sections,
  params,
  size = "default",
  foot,
  narrow = "row",
  showingOpen = false,
  back,
  children,
}: SectionLayoutProps): ReactNode {
  const classes = [
    "section-layout",
    size === "large" && "size-large",
    narrow === "list-or-open" && "narrow-list-or-open",
    narrow === "list-or-open" && showingOpen && "showing-open",
  ].filter(Boolean);
  return (
    <div className={classes.join(" ")}>
      <div className="section-side">
        <nav className="section-menu" aria-label={label}>
          {sections.map((section) => (
            <Link
              key={section.key ?? section.to}
              to={section.to}
              params={section.params ?? params}
              activeProps={{ className: "active" }}
              // An exact match compares the search too, and the Needs you panel adds to it.
              activeOptions={{ exact: section.onlyAtItsAddress ?? false, includeSearch: false }}
            >
              {section.leading ??
                (section.icon !== undefined && (
                  <Icon name={section.icon} size={16} strokeWidth={1.6} />
                ))}
              <span className="section-menu-label">{section.label}</span>
              {section.trailing}
            </Link>
          ))}
        </nav>
        {foot !== undefined && <div className="section-foot">{foot}</div>}
      </div>
      <div className="section-body">
        {narrow === "list-or-open" && back !== undefined && (
          <Link className="section-back" to={back.to}>
            ‹ {back.label}
          </Link>
        )}
        {children}
      </div>
    </div>
  );
}
