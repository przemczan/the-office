import { Drawer } from "@the-office/ui";
import type { ReactNode } from "react";
import { NeedsYouFeed } from "./needs-you-feed.tsx";
import { needsYouWords } from "./now-words.ts";
import { useNeedsYou } from "./use-needs-you.ts";
import { useNeedsYouPanel } from "./use-needs-you-panel.ts";

/**
 * Decisions and Gates over any page, opened from the status strip (spec §4), each answered there
 * as on Now.
 */
export function NeedsYouPanel(): ReactNode {
  const panel = useNeedsYouPanel();
  const needsYou = useNeedsYou();
  if (!panel.isOpen || !needsYou) return null;
  const count = needsYou.shown.length;
  return (
    <Drawer
      title="Needs you"
      description={`${count} ${needsYouWords(count)}, oldest first`}
      width={560}
      onClose={panel.close}
    >
      <div className="feed">
        <NeedsYouFeed needsYou={needsYou} />
      </div>
    </Drawer>
  );
}
