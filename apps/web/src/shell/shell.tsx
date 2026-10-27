import { Outlet, useMatches } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ChatModal } from "./chat/chat-modal.tsx";
import { NeedsYouPanel } from "./notifications/needs-you-panel.tsx";
import { NotificationChannels } from "./notifications/notification-channels.ts";
import { PageHeadingProvider, usePageHeadingState } from "./page-heading.tsx";
import { Rail } from "./rail.tsx";
import "./shell.css";
import { StatusStrip } from "./status-strip.tsx";
import { ToastProvider } from "./toasts.tsx";
import { TopBar } from "./top-bar.tsx";
import { useReportingActivity } from "./user-activity.ts";

/** Shell A3 · Desk: the frame every surface opens in. */
export function Shell(): ReactNode {
  const routeTitle = useMatches({ select: (matches) => matches.at(-1)?.staticData.title });
  const [pageHeading, setPageHeading] = usePageHeadingState();
  useReportingActivity();
  return (
    <ToastProvider>
      <div className="shell">
        <Rail />
        <TopBar
          title={pageHeading?.title ?? routeTitle}
          crumb={pageHeading?.crumb}
          parent={pageHeading?.parent}
        />
        <StatusStrip />
        <main className="shell-main">
          <PageHeadingProvider setPageHeading={setPageHeading}>
            <Outlet />
          </PageHeadingProvider>
        </main>
      </div>
      <ChatModal />
      <NeedsYouPanel />
      <NotificationChannels />
    </ToastProvider>
  );
}
