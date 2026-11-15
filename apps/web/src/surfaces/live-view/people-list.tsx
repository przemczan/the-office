import { Drawer, Icon, IconButton } from "@the-office/ui";
import type { ReactNode } from "react";
import { PersonAvatar } from "../../shell/person-avatar.tsx";
import { LIST_GROUPS } from "./live-states.ts";
import type { ShownPerson } from "./office-people.ts";
import { WorkLinks } from "./work-links.tsx";

export interface PeopleListProps {
  readonly shown: readonly ShownPerson[];
  /** The floor's summary, said under the list's heading. */
  readonly summary: string;
  /** A drawer over the floor on a narrow page, a column beside it otherwise. */
  readonly asDrawer: boolean;
  readonly onShowOnFloor: (roleKey: string) => void;
  readonly onClose: () => void;
}

/** Everyone, grouped by what they are doing (design decision 14). */
export function PeopleList({
  shown,
  summary,
  asDrawer,
  onShowOnFloor,
  onClose,
}: PeopleListProps): ReactNode {
  const groups = <PeopleGroups shown={shown} onShowOnFloor={onShowOnFloor} />;
  if (asDrawer) {
    return (
      <Drawer title={`People · ${shown.length}`} description={summary} onClose={onClose}>
        {groups}
      </Drawer>
    );
  }
  return (
    <aside className="live-list" aria-labelledby="live-list-title">
      <div className="live-list-head">
        <h2 id="live-list-title">People</h2>
        <span className="live-list-count">{shown.length}</span>
        <IconButton
          variant="ghost"
          size="sm"
          icon={<Icon name="x" size={14} />}
          label="Close the list"
          onClick={onClose}
        />
      </div>
      <p className="live-list-summary">{summary}</p>
      <div className="live-list-body">{groups}</div>
    </aside>
  );
}

function PeopleGroups({
  shown,
  onShowOnFloor,
}: Pick<PeopleListProps, "shown" | "onShowOnFloor">): ReactNode {
  return LIST_GROUPS.map(({ state, words }) => {
    const inGroup = shown.filter((entry) => entry.lookState === state);
    if (inGroup.length === 0) return null;
    return (
      <section key={state} className="live-list-group" aria-label={words}>
        <h3>
          {words} · {inGroup.length}
        </h3>
        <ul>
          {inGroup.map((entry) => (
            <PersonRow key={entry.person.roleKey} shown={entry} onShowOnFloor={onShowOnFloor} />
          ))}
        </ul>
      </section>
    );
  });
}

function PersonRow({
  shown: { person, lookState, words, links },
  onShowOnFloor,
}: {
  readonly shown: ShownPerson;
  readonly onShowOnFloor: (roleKey: string) => void;
}): ReactNode {
  const goneHome = lookState === "home";
  return (
    <li className="live-person-row">
      <PersonAvatar roleKey={person.roleKey} name={person.name} size="md" />
      <div className="live-person-text">
        <div className="live-person-name">
          {person.name} <span>· {person.title}</span>
        </div>
        <div className="live-person-state">
          <span className={`live-state-dot ${lookState}`} aria-hidden="true" />
          {words}
        </div>
      </div>
      <IconButton
        variant="ghost"
        size="sm"
        icon={<Icon name="locate" size={16} />}
        label={
          goneHome
            ? `${person.name} has gone home, so isn't on the floor`
            : `Show ${person.name} on the floor`
        }
        disabled={goneHome}
        onClick={() => onShowOnFloor(person.roleKey)}
      />
      <div className="live-person-links">
        <WorkLinks links={links} />
      </div>
    </li>
  );
}
