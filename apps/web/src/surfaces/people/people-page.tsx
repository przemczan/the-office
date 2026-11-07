import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { Preset, Role } from "@the-office/contracts";
import { Alert, Button, Icon, IconButton } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { useChat } from "../../shell/chat/use-chat.tsx";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { HireDialog } from "./hire-dialog.tsx";
import { inGridOrder } from "./people-order.ts";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { CAPABILITIES, taskLimitShort } from "../../shell/role-card-words.ts";
import "./people.css";

/** People (prototypes/app/people.js): a same-size card per person, and hiring. */
export function PeoplePage(): ReactNode {
  const roles = useQuery(roleQueries.list());
  const presets = useQuery(roleCardQueries.presets());
  const [hiring, setHiring] = useState(false);
  const navigate = useNavigate();
  usePageHeading({ title: "People", crumb: roles.data && countOf(roles.data) });
  const unfilled = presetsToHire(presets.data, roles.data);
  return (
    <div className="people-page">
      {roles.error && <Alert tone="danger" title={roles.error.message} />}
      <div className="people-grid">
        {roles.data &&
          inGridOrder(roles.data).map((role) => <PersonCard key={role.key} role={role} />)}
        <article className="person-tile hire-tile">
          <div className="person-tile-head">
            <span className="hire-icon">
              <Icon name="user-plus" size={16} />
            </span>
            <div>
              <h2 className="person-tile-name">Hire a Role</h2>
              <div className="person-tile-title">From a preset or from scratch</div>
            </div>
          </div>
          <p className="person-tile-text">
            {unfilled.length > 0
              ? `${unfilled.map(({ card }) => card.title).join(", ")} to fill. `
              : ""}
            Every setting can change later on the Role card.
          </p>
          <div className="hire-tile-actions">
            {unfilled.length > 0 && (
              <Button variant="secondary" onClick={() => setHiring(true)}>
                Hire a Role
              </Button>
            )}
            <Button variant="secondary" onClick={() => void navigate({ to: "/hire" })}>
              Start from scratch
            </Button>
          </div>
        </article>
      </div>
      {hiring && <HireDialog presets={unfilled} onClose={() => setHiring(false)} />}
    </div>
  );
}

function PersonCard({ role }: { readonly role: Role }): ReactNode {
  const { card } = role;
  const chat = useChat();
  return (
    <article className="person-tile person-card">
      <div className="person-tile-head">
        <PersonAvatar roleKey={role.key} name={card.name} size="md" />
        <div className="person-tile-grow">
          <h2 className="person-tile-name">
            {/* The whole card opens the page; the chat button sits above the link. */}
            <Link to="/people/$roleKey" params={{ roleKey: role.key }} className="person-tile-link">
              {card.name}
            </Link>
          </h2>
          <div className="person-tile-title">{card.title}</div>
        </div>
        {card.capabilities.chat && !role.letGoAt && (
          <IconButton
            icon={<Icon name="message-circle" size={16} />}
            label={`Open the chat with ${card.name}`}
            className="person-tile-chat"
            onClick={() => chat.open(role.key)}
          />
        )}
      </div>
      <p className="person-tile-text">{card.responsibilities}</p>
      <div className="person-tile-foot">
        {CAPABILITIES.filter(({ key }) => card.capabilities[key]).map(({ key, label, icon }) => (
          <span key={key} className="person-tile-capability" title={label}>
            <Icon name={icon} size={14} />
            <span className="visually-hidden">{label}</span>
          </span>
        ))}
        {role.builtIn && (
          <span className="person-tile-built-in">
            <Icon name="lock" size={12} />
            Built in
          </span>
        )}
        {role.letGoAt && <span className="person-tile-let-go">Let go</span>}
        <span className="person-tile-limit">{taskLimitShort(card.taskLimit)}</span>
      </div>
    </article>
  );
}

/** The presets whose Role nobody fills yet. */
function presetsToHire(
  presets: readonly Preset[] | undefined,
  roles: readonly Role[] | undefined,
): Preset[] {
  if (!presets || !roles) return [];
  const filled = new Set(roles.map(({ key }) => key));
  return presets.filter(({ roleKey }) => !filled.has(roleKey));
}

function countOf(roles: readonly Role[]): string {
  return roles.length === 1 ? "1 person" : `${roles.length} people`;
}
