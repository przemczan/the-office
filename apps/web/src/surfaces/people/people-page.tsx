import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Preset, Role } from "@the-office/contracts";
import { Alert, Avatar, Button, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { HireDialog } from "./hire-dialog.tsx";
import { CAPABILITIES, taskLimitShort } from "./role-card-labels.ts";
import "./people.css";

/** People (prototypes/app/people.js): a same-size card per person, and hiring from the presets. */
export function PeoplePage(): ReactNode {
  const roles = useQuery(roleQueries.list());
  const presets = useQuery(roleCardQueries.presets());
  const [hiring, setHiring] = useState(false);
  usePageHeading({ title: "People", crumb: roles.data && countOf(roles.data) });
  const unfilled = presetsToHire(presets.data, roles.data);
  return (
    <div className="people-page">
      {roles.error && <Alert tone="danger" title={roles.error.message} />}
      <div className="people-grid">
        {roles.data?.map((role) => (
          <PersonCard key={role.key} role={role} />
        ))}
        {unfilled.length > 0 && (
          <article className="person-tile hire-tile">
            <div className="person-tile-head">
              <span className="hire-icon">
                <Icon name="user-plus" size={16} />
              </span>
              <div>
                <h2 className="person-tile-name">Hire a Role</h2>
                <div className="person-tile-title">From a preset</div>
              </div>
            </div>
            <p className="person-tile-text">
              {unfilled.map(({ card }) => card.title).join(", ")} to fill. Every setting can change
              later on the Role card.
            </p>
            <div>
              <Button variant="secondary" onClick={() => setHiring(true)}>
                Hire a Role
              </Button>
            </div>
          </article>
        )}
      </div>
      {hiring && <HireDialog presets={unfilled} onClose={() => setHiring(false)} />}
    </div>
  );
}

function PersonCard({ role }: { readonly role: Role }): ReactNode {
  const { card } = role;
  return (
    <Link to="/people/$roleKey" params={{ roleKey: role.key }} className="person-tile person-card">
      <div className="person-tile-head">
        <Avatar name={card.name} size="md" />
        <div className="person-tile-grow">
          <h2 className="person-tile-name">{card.name}</h2>
          <div className="person-tile-title">{card.title}</div>
        </div>
      </div>
      <p className="person-tile-text">{card.responsibilities}</p>
      <div className="person-tile-foot">
        {CAPABILITIES.filter(({ key }) => card.capabilities[key]).map(({ key, label, icon }) => (
          <span key={key} className="person-tile-capability" title={label}>
            <Icon name={icon} size={14} />
            <span className="visually-hidden">{label}</span>
          </span>
        ))}
        <span className="person-tile-limit">{taskLimitShort(card.taskLimit)}</span>
      </div>
    </Link>
  );
}

/** The presets whose Role nobody fills yet; hiring from scratch comes with tier 2. */
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
