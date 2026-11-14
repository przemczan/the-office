import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Duty, Preset, ProposedChange, Role, RoleCard } from "@the-office/contracts";
import { Badge, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { dutyQueries } from "../../api/people.ts";
import { fallbackWords, NOBODY } from "../duty-words.ts";
import { personName } from "../person-name.ts";
import { CAPABILITIES } from "../role-card-words.ts";

export type ProposedOfficeSetupChange = Extract<ProposedChange, { kind: "office-setup" }>;

/** A hire of the set-up as the card shows it, whether from a preset or from scratch. */
interface HireShown {
  readonly roleKey: string;
  readonly name: string;
  readonly title: string;
  readonly fromPreset: boolean;
  /** Undefined until the preset is read. */
  readonly card: Pick<RoleCard, "responsibilities" | "capabilities"> | undefined;
}

/** "Hire 2 and assign duties", or "Assign duties" for a set-up of duties only. */
export function officeSetupApplyLabel({ hires }: ProposedOfficeSetupChange): string {
  return hires.length === 0 ? "Assign duties" : `Hire ${hires.length} and assign duties`;
}

/**
 * The Caretaker's set-up of The Office (spec §2.2): each person it hires, from a preset or from
 * scratch, linked to their page once hired, and who holds every duty after it, the ones it assigns
 * marked and the ones left unheld with what happens meanwhile. Nothing is edited here: a hire's
 * key comes from its title, and names change on the Role card once hired.
 */
export function ProposedOfficeSetup({
  change,
  presets,
  roles,
}: {
  readonly change: ProposedOfficeSetupChange;
  readonly presets: readonly Preset[] | undefined;
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  const duties = useQuery(dutyQueries.list()).data;
  const hires = change.hires.map((hire) => hireShown(hire, presets));
  return (
    <>
      {hires.length > 0 && (
        <ul className="proposal-setup-hires">
          {hires.map((hire, index) => (
            <HireLine key={hire.roleKey} hire={hire} hiredKey={change.hiredKeys?.[index]} />
          ))}
        </ul>
      )}
      {duties && <DutiesAfter change={change} duties={duties} hires={hires} roles={roles} />}
    </>
  );
}

function hireShown(
  hire: ProposedOfficeSetupChange["hires"][number],
  presets: readonly Preset[] | undefined,
): HireShown {
  if (hire.kind === "hire") {
    const { name, title } = hire.card;
    return { roleKey: hire.roleKey, name, title, fromPreset: false, card: hire.card };
  }
  const preset = presets?.find(({ roleKey }) => roleKey === hire.roleKey);
  return {
    roleKey: hire.roleKey,
    name: hire.name,
    title: preset?.card.title ?? hire.roleKey,
    fromPreset: true,
    card: preset?.card,
  };
}

function HireLine({
  hire: { name, title, fromPreset, card },
  hiredKey,
}: {
  readonly hire: HireShown;
  /** The Role the person was hired into, once applied. */
  readonly hiredKey: string | undefined;
}): ReactNode {
  const words = `${name} · ${title}`;
  return (
    <li className="proposal-setup-hire">
      <div className="proposal-setup-hire-head">
        {hiredKey ? (
          <Link
            to="/people/$roleKey"
            params={{ roleKey: hiredKey }}
            className="proposal-setup-name"
          >
            {words}
          </Link>
        ) : (
          <span className="proposal-setup-name">{words}</span>
        )}
        <span className="proposal-note">{fromPreset ? "from the preset" : "from scratch"}</span>
        {card && (
          <span className="proposal-setup-capabilities">
            {CAPABILITIES.filter(({ key }) => card.capabilities[key]).map(
              ({ key, label, icon }) => (
                <span key={key} title={label}>
                  <Icon name={icon} size={14} />
                  <span className="visually-hidden">{label}</span>
                </span>
              ),
            )}
          </span>
        )}
      </div>
      {card && <p className="proposal-setup-text">{card.responsibilities}</p>}
    </li>
  );
}

/** Every duty with its holder once the set-up is made, in the order the service lists them. */
function DutiesAfter({
  change,
  duties,
  hires,
  roles,
}: {
  readonly change: ProposedOfficeSetupChange;
  readonly duties: readonly Duty[];
  readonly hires: readonly HireShown[];
  readonly roles: readonly Role[] | undefined;
}): ReactNode {
  return (
    <table className="proposal-setup-duties">
      <caption className="visually-hidden">Who holds each duty after the set-up</caption>
      <thead>
        <tr>
          <th scope="col">Duty</th>
          <th scope="col">Held by after the set-up</th>
        </tr>
      </thead>
      <tbody>
        {duties.map(({ key, label, roleKey: namedNow }) => {
          const assigned = change.duties.find(({ duty }) => duty === key);
          const holder = holderAfter(assigned ? assigned.to : namedNow, hires, roles);
          return (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td>
                <span className={holder ? undefined : "proposal-note"}>{holder ?? NOBODY}</span>
                {assigned && <Badge tone="accent">Assigned</Badge>}
                {!holder && <span className="proposal-note">{fallbackWords(key)}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Who holds a duty naming `roleKey` after the set-up: one of its hires, or someone hired now and not
 * let go; undefined when nobody does.
 */
function holderAfter(
  roleKey: string | null,
  hires: readonly HireShown[],
  roles: readonly Role[] | undefined,
): string | undefined {
  if (roleKey === null) return undefined;
  const hire = hires.find((each) => each.roleKey === roleKey);
  if (hire) return `${hire.name} · ${hire.title}`;
  const role = roles?.find(({ key, builtIn, letGoAt }) => key === roleKey && !builtIn && !letGoAt);
  return role && personName(role);
}
