import { Drawer, SidePanelEdge } from "@the-office/ui";
import type { ReactNode } from "react";
import { NeedsYouFeed } from "./needs-you-feed.tsx";
import {
  NEEDS_YOU_PANEL_WIDTHS,
  rememberNeedsYouPanelWidth,
  showNeedsYouPanelWidth,
  useNeedsYouPanelLayout,
} from "./needs-you-panel-width.ts";
import { needsYouWords } from "./now-words.ts";
import { useNeedsYou } from "./use-needs-you.ts";
import { useNeedsYouPanel } from "./use-needs-you-panel.ts";
import { useWaitingForYou } from "./use-waiting-for-you.ts";
import { WaitingForYouGroup } from "./waiting-for-you-feed.tsx";

/**
 * Decisions and Gates over any page, then what is Waiting for you, opened from the status strip
 * (spec §4), the same cards as on Now, answered there. Its description counts the Decisions and
 * Gates alone. Its left edge resizes it, as the chat drawer's does.
 */
export function NeedsYouPanel(): ReactNode {
  const panel = useNeedsYouPanel();
  const needsYou = useNeedsYou();
  const waitingForYou = useWaitingForYou();
  const layout = useNeedsYouPanelLayout();
  if (!panel.isOpen || !needsYou) return null;
  const count = needsYou.shown.length;
  return (
    <Drawer
      title="Needs you"
      description={`${count} ${needsYouWords(count)}, oldest first`}
      width={layout.width}
      // The edge is placed against the panel, outside its scrolling content.
      style={{ position: "relative" }}
      onClose={panel.close}
    >
      {!layout.fills && (
        <SidePanelEdge
          label="Resize the Needs you panel"
          width={layout.width}
          least={NEEDS_YOU_PANEL_WIDTHS.least}
          most={layout.most}
          standard={NEEDS_YOU_PANEL_WIDTHS.standard}
          onResize={showNeedsYouPanelWidth}
          onResized={rememberNeedsYouPanelWidth}
        />
      )}
      <div className="feed">
        <NeedsYouFeed needsYou={needsYou} />
      </div>
      {waitingForYou && <WaitingForYouGroup waitingForYou={waitingForYou} />}
    </Drawer>
  );
}
