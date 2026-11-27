import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import type { ChatThreadPage, ThreadWebEvent } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { threadEventCacheUpdates, threadQueries } from "./conversations.ts";

const KEPT = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const GONE = "7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const HOME = { kind: "chat", roleKey: "designer" } as const;

function pages(): InfiniteData<ChatThreadPage> {
  const rows = [{ id: KEPT }, { id: GONE }] as ChatThreadPage["rows"];
  return { pages: [{ rows, next: null, total: 2 }], pageParams: [undefined] };
}

describe("a deleted chat Thread's event", () => {
  it("drops the row from its chat's pages and counts one fewer", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(threadQueries.inChat("designer").queryKey, pages());
    const event: ThreadWebEvent = {
      type: "thread.deleted",
      occurredAt: "2026-11-27T14:00:00.000Z",
      threadId: GONE,
      home: HOME,
    };

    threadEventCacheUpdates["thread.deleted"](event, queryClient);

    const after = queryClient.getQueryData<InfiniteData<ChatThreadPage>>(
      threadQueries.inChat("designer").queryKey,
    );
    expect(after?.pages[0]?.rows.map(({ id }) => id)).toEqual([KEPT]);
    expect(after?.pages[0]?.total).toBe(1);
  });

  it("leaves another person's chat alone", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(threadQueries.inChat("tester").queryKey, pages());

    const event: ThreadWebEvent = {
      type: "thread.deleted",
      occurredAt: "2026-11-27T14:00:00.000Z",
      threadId: GONE,
      home: HOME,
    };
    threadEventCacheUpdates["thread.deleted"](event, queryClient);

    expect(
      queryClient.getQueryData<InfiniteData<ChatThreadPage>>(
        threadQueries.inChat("tester").queryKey,
      )?.pages[0]?.rows,
    ).toHaveLength(2);
  });
});
