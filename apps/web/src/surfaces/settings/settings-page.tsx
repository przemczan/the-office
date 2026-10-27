import { Link, Outlet } from "@tanstack/react-router";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import "./settings.css";

/** Settings' sections, each a page of its own; later tasks add theirs here. */
const SECTIONS = [
  { to: "/settings/skills", icon: "sparkles", label: "Skills" },
  { to: "/settings/office-limits", icon: "gauge", label: "Office limits" },
] as const;

/** Settings (prototypes/app/settings.js): its sections beside the open one. */
export function SettingsPage(): ReactNode {
  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Settings">
        {SECTIONS.map((section) => (
          <Link key={section.to} to={section.to} activeProps={{ className: "active" }}>
            <Icon name={section.icon} size={16} strokeWidth={1.6} />
            {section.label}
          </Link>
        ))}
      </nav>
      <div className="settings-body">
        <Outlet />
      </div>
    </div>
  );
}
