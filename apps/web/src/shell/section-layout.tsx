import { Link, type LinkProps } from "@tanstack/react-router";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import "./section-layout.css";

export interface MenuSection {
  readonly to: NonNullable<LinkProps["to"]>;
  readonly icon: string;
  readonly label: string;
  /** For a section at its parent's own address, which every other section's address starts with. */
  readonly onlyAtItsAddress?: boolean;
}

interface SectionLayoutProps {
  /** Names the menu for screen readers. */
  readonly label: string;
  readonly sections: readonly MenuSection[];
  /** What the sections' addresses leave open, such as the Project's id. */
  readonly params?: LinkProps["params"];
  /** The open section. */
  readonly children: ReactNode;
}

/** A page of sections, each with its own address: the left-hand menu beside the open one. */
export function SectionLayout({
  label,
  sections,
  params,
  children,
}: SectionLayoutProps): ReactNode {
  return (
    <div className="section-layout">
      <nav className="section-menu" aria-label={label}>
        {sections.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            params={params}
            activeProps={{ className: "active" }}
            // An exact match compares the search too, and the Needs you panel adds to it.
            activeOptions={{ exact: section.onlyAtItsAddress ?? false, includeSearch: false }}
          >
            <Icon name={section.icon} size={16} strokeWidth={1.6} />
            {section.label}
          </Link>
        ))}
      </nav>
      <div className="section-body">{children}</div>
    </div>
  );
}
