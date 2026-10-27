import { useQuery } from "@tanstack/react-query";
import { Drawer } from "@the-office/ui";
import type { ReactNode } from "react";
import { nowQueries } from "../../api/notifications.ts";
import { NeedsYouFeed } from "./needs-you-feed.tsx";
import { needsYouWords } from "./now-words.ts";
import { useNeedsYouPanel } from "./use-needs-you-panel.ts";

/**
 * Decisions and Gates over any page, opened from the status strip (spec §4), each answered there
 * as on Now.
 */
export function NeedsYouPanel(): ReactNode {
  const panel = useNeedsYouPanel();
  const needsYou = useQuery(nowQueries.now()).data?.needsYou;
  if (!panel.isOpen || !needsYou) return null;
  return (
    <Drawer
      title="Needs you"
      description={`${needsYou.length} ${needsYouWords(needsYou.length)}, oldest first`}
      width={560}
      onClose={panel.close}
    >
      <div className="feed">
        <NeedsYouFeed items={needsYou} />
      </div>
    </Drawer>
  );
}
