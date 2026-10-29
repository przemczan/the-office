import type { ReactNode } from "react";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RoutingCard } from "./routing-card.tsx";
import "./notifications.css";

/** Settings › Notifications: what goes where. */
export function NotificationsSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Notifications" });
  return <RoutingCard />;
}
