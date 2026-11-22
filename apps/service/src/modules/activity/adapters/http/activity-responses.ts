import {
  activityItemSchema,
  type Activity as ActivityResponse,
  type ActivityItem as ActivityItemResponse,
} from "@the-office/contracts";
import type { Activity, ActivityItem } from "../../domain/activity.js";

export function toActivityResponse({ items, count }: Activity): ActivityResponse {
  return { items: items.map(toActivityItemResponse), count };
}

/**
 * Parsed, as the domain keeps the owning modules' states as plain strings, each one of the
 * contracts' as the owning module answers it.
 */
function toActivityItemResponse(item: ActivityItem): ActivityItemResponse {
  return activityItemSchema.parse({
    ...item,
    since: item.since.toISOString(),
    endedAt: item.endedAt?.toISOString() ?? null,
  });
}
