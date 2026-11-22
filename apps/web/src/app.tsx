import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { threadEventCacheUpdates, threadEventInvalidations } from "./api/conversations.ts";
import {
  EventStreamProvider,
  type EventCacheUpdates,
  type EventInvalidations,
} from "./api/event-stream-provider.tsx";
import { deviceEventInvalidations, projectDeviceEventInvalidations } from "./api/devices.ts";
import { engineEventInvalidations } from "./api/engine.ts";
import { gitHubEventInvalidations } from "./api/github.ts";
import { liveViewEventCacheUpdates } from "./api/live-view.ts";
import { promptTemplateEventInvalidations } from "./api/prompt-templates.ts";
import { mcpServerEventInvalidations } from "./api/mcp-servers.ts";
import { notificationEventCacheUpdates } from "./api/notifications.ts";
import { roleEventInvalidations } from "./api/people.ts";
import { pipelineEventInvalidations } from "./api/pipelines.ts";
import { projectEventInvalidations, repositoryCloneEventInvalidations } from "./api/projects.ts";
import { activityEventInvalidations } from "./api/activity.ts";
import { ciRunEventInvalidations } from "./api/ci-runs.ts";
import { pullRequestEventInvalidations } from "./api/pull-requests.ts";
import { officeUpdateEventInvalidations } from "./api/office-updates.ts";
import { runEnvironmentEventInvalidations } from "./api/run-environments.ts";
import { skillEventCacheUpdates, skillEventInvalidations } from "./api/skills.ts";
import { testInstanceEventInvalidations } from "./api/test-instances.ts";
import { userEventInvalidations } from "./api/users.ts";
import { workEventCacheUpdates, workEventInvalidations } from "./api/work.ts";
import { router as officeRouter, type OfficeRouter } from "./router.tsx";
import { officeQueryClient, sendToSignIn } from "./signed-out.ts";

// Each surface adds the event types it receives and the queries their events make stale.
const EVENT_INVALIDATIONS: EventInvalidations = {
  ...projectEventInvalidations,
  ...repositoryCloneEventInvalidations,
  ...pipelineEventInvalidations,
  ...roleEventInvalidations,
  ...skillEventInvalidations,
  ...officeUpdateEventInvalidations,
  ...mcpServerEventInvalidations,
  ...gitHubEventInvalidations,
  ...pullRequestEventInvalidations,
  ...ciRunEventInvalidations,
  ...activityEventInvalidations,
  ...runEnvironmentEventInvalidations,
  ...testInstanceEventInvalidations,
  ...deviceEventInvalidations,
  ...projectDeviceEventInvalidations,
  ...engineEventInvalidations,
  ...threadEventInvalidations,
  ...workEventInvalidations,
  ...userEventInvalidations,
  ...promptTemplateEventInvalidations,
};

// The event types that carry what changed or name exactly what it changes, and how they change the
// cached queries.
const EVENT_CACHE_UPDATES: EventCacheUpdates = {
  ...threadEventCacheUpdates,
  ...notificationEventCacheUpdates,
  ...skillEventCacheUpdates,
  ...workEventCacheUpdates,
  ...liveViewEventCacheUpdates,
};

/**
 * The Office's web app. A 401 from any query or change, or the event stream closed as this device
 * was signed out, sends the browser to the sign-in page (`sendToSignIn`). A test gives its own
 * router, on a memory history, and WebSocket.
 */
export function App({
  router = officeRouter,
  openWebSocket,
}: {
  readonly router?: OfficeRouter;
  readonly openWebSocket?: (url: string) => WebSocket;
}): ReactNode {
  const [queryClient] = useState(() => officeQueryClient(() => sendToSignIn(router)));
  return (
    <QueryClientProvider client={queryClient}>
      <EventStreamProvider
        invalidations={EVENT_INVALIDATIONS}
        cacheUpdates={EVENT_CACHE_UPDATES}
        onSignedOut={() => sendToSignIn(router)}
        {...(openWebSocket && { openWebSocket })}
      >
        <RouterProvider router={router} />
      </EventStreamProvider>
    </QueryClientProvider>
  );
}
