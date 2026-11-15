import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { Button } from "@the-office/ui";
import type { ReactNode } from "react";

/** What "Show more" needs of a list read a page at a time (`api/pages.ts`). */
type PagedList = Pick<
  UseInfiniteQueryResult,
  "hasNextPage" | "isFetchingNextPage" | "fetchNextPage"
>;

/** "Show more" under a list read a page at a time, while another page follows; nothing after. */
export function ShowMore({ list }: { readonly list: PagedList }): ReactNode {
  if (!list.hasNextPage) return null;
  return (
    <div className="show-more">
      <Button
        size="sm"
        variant="ghost"
        loading={list.isFetchingNextPage}
        onClick={() => void list.fetchNextPage()}
      >
        Show more
      </Button>
    </div>
  );
}
