import type { ReactNode } from "react";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RoutingCard } from "./routing-card.tsx";
import { TimingCards } from "./timing-cards.tsx";
import "./notifications.css";

/** Settings › Notifications: what goes where, and when it reaches the desktop and the phone. */
export function NotificationsSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Notifications" });
  return (
    <>
      <RoutingCard />
      <TimingCards />
    </>
  );
}
