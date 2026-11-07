import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Message } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { nowQueries } from "../../api/notifications.ts";
import { roleQueries } from "../../api/people.ts";
import { PersonAvatar } from "../person-avatar.tsx";
import { personName } from "../person-name.ts";
import { personStatus } from "./link-card-words.ts";
import { pausedWords, waitingWords } from "./office-status-words.ts";
import "./conversation.css";

type OfficeStatusMessage = Extract<Message, { kind: "office-status" }>;

/**
 * The Office status the Office Manager shows (spec §2.2): Office-wide and read-only, what waits on
 * the user and who is on what, read from Now as it is whenever the card is shown.
 */
export function OfficeStatusCard({ card }: { readonly card: OfficeStatusMessage }): ReactNode {
  const now = useQuery(nowQueries.now()).data;
  const roles = useQuery(roleQueries.list()).data ?? [];
  const running = now?.running ?? [];
  const waiting = now ? waitingWords(now.needsYou) : undefined;
  const paused = pausedWords(running);
  return (
    <section className="message chat-card" aria-label="Office status">
      <div className="office-status-line">
        <Icon name="inbox" size={14} />
        <span className="office-status-words">{waiting ?? "Reading what waits on you…"}</span>
        {now && now.needsYou.length > 0 && (
          <Link className="proposal-link" to="/now">
            Open Now
          </Link>
        )}
      </div>
      {paused !== undefined && (
        <div className="office-status-line">
          <Icon name="pause" size={14} />
          <span className="office-status-words">{paused}</span>
        </div>
      )}
      <ul className="office-status-people">
        {roles
          .filter(({ key }) => key !== card.roleKey)
          .map((role) => (
            <li key={role.key} className="office-status-person">
              <PersonAvatar roleKey={role.key} name={role.card.name} size="sm" />
              <span className="office-status-name">{personName(role)}</span>
              <span className="office-status-doing">{personStatus(role.key, running)}</span>
            </li>
          ))}
      </ul>
    </section>
  );
}
