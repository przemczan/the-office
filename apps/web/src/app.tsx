import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { shouldRetry } from "./api/api-client.ts";
import { EventStreamProvider, type EventInvalidations } from "./api/event-stream-provider.tsx";
import { roleEventInvalidations } from "./api/people.ts";
import { projectEventInvalidations } from "./api/projects.ts";
import { skillEventInvalidations } from "./api/skills.ts";
import { router } from "./router.tsx";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } });

// Each surface adds the event types it receives and the queries their events make stale.
const EVENT_INVALIDATIONS: EventInvalidations = {
  ...projectEventInvalidations,
  ...roleEventInvalidations,
  ...skillEventInvalidations,
};

export function App(): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <EventStreamProvider invalidations={EVENT_INVALIDATIONS}>
        <RouterProvider router={router} />
      </EventStreamProvider>
    </QueryClientProvider>
  );
}
