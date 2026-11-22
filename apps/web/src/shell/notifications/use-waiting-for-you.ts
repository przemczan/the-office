import { useQuery } from "@tanstack/react-query";
import type { WaitingForYouItem } from "@the-office/contracts";
import { nowQueries } from "../../api/notifications.ts";
import { narrowed, type Narrowed } from "../project-filter/project-filter-choices.ts";
import { useProjectFilter } from "../project-filter/use-project-filter.ts";

/**
 * What waits on the user without blocking anyone, in the Projects the filter shows, and how many
 * more wait elsewhere; an Office-wide item, in no Project, always shows.
 */
export function useWaitingForYou(): Narrowed<WaitingForYouItem> | undefined {
  const waitingForYou = useQuery(nowQueries.now()).data?.waitingForYou;
  const { shows } = useProjectFilter();
  return waitingForYou && narrowed(waitingForYou, ({ projectIds }) => shows(projectIds));
}
