import { useQuery } from "@tanstack/react-query";
import type { NeedsYouItem } from "@the-office/contracts";
import { nowQueries } from "../../api/notifications.ts";
import { narrowed, type Narrowed } from "../project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../project-filter/use-project-filter.ts";

/**
 * What waits on the user in the Projects the filter shows, and how many more wait elsewhere: Now,
 * the Needs you panel and the status strip narrow alike, while the rail badge counts them all.
 */
export function useNeedsYou(): Narrowed<NeedsYouItem> | undefined {
  const needsYou = useQuery(nowQueries.now()).data?.needsYou;
  const { shows } = useProjectFilter();
  return needsYou && narrowed(needsYou, ({ projectId }) => shows([projectId]));
}
