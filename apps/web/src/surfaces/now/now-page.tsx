import type { ReactNode } from "react";
import { Desk, Feed, Panel, PanelHeading } from "../../shell/desk.tsx";
import { EmptyCard } from "../../shell/item-card.tsx";

/** Home: what needs the user, what is running and what happened since they left (task 16). */
export function NowPage(): ReactNode {
  return (
    <Desk>
      <Panel>
        <PanelHeading icon="inbox" title="Needs you" />
        <Feed>
          <EmptyCard>Nothing needs you. Enjoy it.</EmptyCard>
        </Feed>
      </Panel>
      <Panel>
        <PanelHeading
          icon="activity"
          title="Running"
          action={{ label: "Open Work", to: "/work" }}
        />
        <Feed>
          <EmptyCard>Nothing is running.</EmptyCard>
        </Feed>
        <PanelHeading icon="moon" title="Since you left" />
        <Feed>
          <EmptyCard>Nothing finished since you left.</EmptyCard>
        </Feed>
      </Panel>
    </Desk>
  );
}
