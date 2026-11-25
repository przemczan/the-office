import { Outlet, useMatches } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { AccountAppearance } from "./account-appearance.tsx";
import { ActivityPanel } from "./activity/activity-panel.tsx";
import { ChatDrawer } from "./chat/chat-drawer.tsx";
import { useChatDrawerLayout } from "./chat/chat-drawer-width.ts";
import { ChatProvider, useChat } from "./chat/use-chat.tsx";
import { DecisionDraftsProvider } from "./conversation/decision-drafts.tsx";
import { useRunRelays } from "./devices/run-relays.ts";
import { HandoverNotesProvider } from "./conversation/handover-notes.tsx";
import { ThreadDraftsProvider } from "./conversation/thread-drafts.tsx";
import { FireAlarmReviewProvider } from "./fire-alarm/fire-alarm-review.tsx";
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
  useReportingActivity();
  return (
    <ToastProvider>
      <AccountAppearance />
      <HandoverNotesProvider>
        <ThreadDraftsProvider>
          <DecisionDraftsProvider>
            <ChatProvider>
              <FireAlarmReviewProvider>
                <ShellFrame />
              </FireAlarmReviewProvider>
              <NeedsYouPanel />
              <ActivityPanel />
              <NotificationChannels />
            </ChatProvider>
          </DecisionDraftsProvider>
        </ThreadDraftsProvider>
      </HandoverNotesProvider>
    </ToastProvider>
  );
}

function ShellFrame(): ReactNode {
  useRunRelays();
  const routeTitle = useMatches({ select: (matches) => matches.at(-1)?.staticData.title });
  const [pageHeading, setPageHeading] = usePageHeadingState();
  const chat = useChat();
  const { place, width } = useChatDrawerLayout();
  const chatCovers = chat.isOpen && place !== "fills" ? width : 0;
  return (
    <div
      className="shell"
      style={
        {
          "--chat-drawer-width": `${width}px`,
          "--chat-drawer-covers": `${chatCovers}px`,
        } as CSSProperties
      }
    >
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
      <ChatDrawer />
    </div>
  );
}
