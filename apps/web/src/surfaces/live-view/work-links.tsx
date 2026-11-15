import { Link, linkOptions } from "@tanstack/react-router";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import type { WorkLink, WorkTarget } from "./live-view-types.ts";

/** Where a piece of someone's work opens: a link's props, and what a press on them navigates to. */
export function workLinkOptions(target: WorkTarget) {
  switch (target.kind) {
    case "task":
      return linkOptions({
        to: "/tasks/$taskId",
        params: { taskId: target.taskId },
        search: {
          taskThread: target.threadId,
          ...(target.decisionId !== null && { decision: target.decisionId }),
        },
      });
    case "initiative":
      return linkOptions({
        to: "/work/initiatives/$initiativeId",
        params: { initiativeId: target.initiativeId },
        search: { initiativeThread: target.threadId },
      });
    case "chat":
      // The shell opens the chat drawer from the address and takes these out of it again.
      return linkOptions({
        to: "/live-view",
        search: {
          chat: target.roleKey,
          ...(target.threadId !== null && { thread: target.threadId }),
        },
      });
    case "person":
      return linkOptions({ to: "/people/$roleKey", params: { roleKey: target.roleKey } });
  }
}

const TARGET_ICONS: Record<WorkTarget["kind"], string> = {
  task: "square-check",
  initiative: "flag",
  chat: "message-circle",
  person: "user",
};

/** Someone's work, one link a line. */
export function WorkLinks({ links }: { readonly links: readonly WorkLink[] }): ReactNode {
  return (
    <ul className="live-work-links">
      {links.map((link) => (
        <li key={JSON.stringify(link.target)}>
          <Link {...workLinkOptions(link.target)} className="live-work-link">
            <Icon name={TARGET_ICONS[link.target.kind]} size={14} />
            <span>{link.words}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
