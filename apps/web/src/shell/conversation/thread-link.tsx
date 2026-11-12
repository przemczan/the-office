import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { threadQueries } from "../../api/conversations.ts";

/**
 * The way to a Thread wherever it is: a chat opens in the chat drawer, through the address's way in;
 * a Thread on a Task on the Task's page, and an Initiative's on the Initiative's. Plain words until
 * the Thread is read.
 */
export function ThreadLink({
  threadId,
  children,
}: {
  readonly threadId: string;
  readonly children: ReactNode;
}): ReactNode {
  const home = useQuery(threadQueries.one(threadId)).data?.home;
  switch (home?.kind) {
    case undefined:
      return <span>{children}</span>;
    case "chat":
      return (
        <Link
          to="."
          search={(shown) => ({ ...shown, chat: home.roleKey, thread: threadId })}
          resetScroll={false}
        >
          {children}
        </Link>
      );
    case "task":
      return (
        <Link
          to="/tasks/$taskId"
          params={{ taskId: home.taskId }}
          search={{ taskThread: threadId }}
        >
          {children}
        </Link>
      );
    case "initiative":
      return (
        <Link
          to="/work/initiatives/$initiativeId"
          params={{ initiativeId: home.initiativeId }}
          search={{ initiativeThread: threadId }}
        >
          {children}
        </Link>
      );
  }
}
