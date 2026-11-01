import { Link, Outlet } from "@tanstack/react-router";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import "./settings.css";

/** Settings' sections, each a page of its own; later tasks add theirs here. */
const SECTIONS = [
  { to: "/settings/pipelines", icon: "route", label: "Pipelines" },
  { to: "/settings/skills", icon: "sparkles", label: "Skills" },
  { to: "/settings/mcp-servers", icon: "plug", label: "MCP servers" },
  { to: "/settings/engines", icon: "cpu", label: "Engines" },
  { to: "/settings/office-identity", icon: "fingerprint", label: "Office identity" },
  { to: "/settings/office-limits", icon: "gauge", label: "Office limits" },
  { to: "/settings/notifications", icon: "bell", label: "Notifications" },
  { to: "/settings/appearance", icon: "palette", label: "Appearance" },
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
