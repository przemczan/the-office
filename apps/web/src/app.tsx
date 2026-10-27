import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { shouldRetry } from "./api/api-client.ts";
import { threadEventCacheUpdates, threadEventInvalidations } from "./api/conversations.ts";
import {
  EventStreamProvider,
  type EventCacheUpdates,
  type EventInvalidations,
} from "./api/event-stream-provider.tsx";
import { nowEventCacheUpdates } from "./api/notifications.ts";
import { roleEventInvalidations } from "./api/people.ts";
import { pipelineEventInvalidations } from "./api/pipelines.ts";
import { projectEventInvalidations } from "./api/projects.ts";
import { skillEventInvalidations } from "./api/skills.ts";
import { workEventInvalidations } from "./api/work.ts";
import { router } from "./router.tsx";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } });

// Each surface adds the event types it receives and the queries their events make stale.
const EVENT_INVALIDATIONS: EventInvalidations = {
  ...projectEventInvalidations,
  ...pipelineEventInvalidations,
  ...roleEventInvalidations,
  ...skillEventInvalidations,
  ...threadEventInvalidations,
  ...workEventInvalidations,
};

// The event types that carry what changed, and how they change the cached queries in place.
const EVENT_CACHE_UPDATES: EventCacheUpdates = {
  ...threadEventCacheUpdates,
  ...nowEventCacheUpdates,
};

export function App(): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <EventStreamProvider invalidations={EVENT_INVALIDATIONS} cacheUpdates={EVENT_CACHE_UPDATES}>
        <RouterProvider router={router} />
      </EventStreamProvider>
    </QueryClientProvider>
  );
}
