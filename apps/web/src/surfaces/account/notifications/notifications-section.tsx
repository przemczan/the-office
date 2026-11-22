import type { ReactNode } from "react";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RoutingCard } from "./routing-card.tsx";
import { TimingCards } from "./timing-cards.tsx";
import "./notifications.css";

/**
 * Account › Notifications: what goes where, and when it reaches the desktop and the phone; each
 * kept for the signed-in user alone.
 */
export function NotificationsSection(): ReactNode {
  usePageHeading({ title: "Account", crumb: "Notifications" });
  return (
    <div className="account-cards">
      <RoutingCard />
      <TimingCards />
    </div>
  );
}
