import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SectionLayout, type MenuSection } from "../../shell/section-layout.tsx";
import "./settings.css";

/** Settings' sections, each a page of its own; later tasks add theirs here. */
const SECTIONS: readonly MenuSection[] = [
  { to: "/settings/pipelines", icon: "route", label: "Pipelines" },
  { to: "/settings/duties", icon: "briefcase", label: "Duties" },
  { to: "/settings/skills", icon: "sparkles", label: "Skills" },
  { to: "/settings/mcp-servers", icon: "plug", label: "MCP servers" },
  { to: "/settings/engines", icon: "cpu", label: "Engines" },
  { to: "/settings/office-identity", icon: "fingerprint", label: "Office identity" },
  { to: "/settings/office-limits", icon: "gauge", label: "Office limits" },
  { to: "/settings/office-instructions", icon: "scroll-text", label: "Office instructions" },
  { to: "/settings/notifications", icon: "bell", label: "Notifications" },
  { to: "/settings/updates", icon: "refresh-cw", label: "Updates" },
  { to: "/settings/appearance", icon: "palette", label: "Appearance" },
];

/** Settings (prototypes/app/settings.js): its sections beside the open one. */
export function SettingsPage(): ReactNode {
  return (
    <div className="settings-page">
      <SectionLayout label="Settings" sections={SECTIONS}>
        <Outlet />
      </SectionLayout>
    </div>
  );
}
