import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { skillQueries } from "../../api/skills.ts";
import { EFFORT_LABELS, modelLabel } from "../../shell/engine-words.ts";
import { SkillChip } from "../../shell/skill-chip.tsx";
import { PersonBlock } from "./role-card-layout.tsx";
import { SESSION_DEFAULTS, taskLimitLabel } from "../../shell/role-card-words.ts";
import { sessionSkillsOf } from "./session-skills.ts";

/** Who the person is, what they work with, and their skills. */
export function OverviewTab(): ReactNode {
  const { roleKey } = useParams({ from: "/people/$roleKey/" });
  const role = useQuery(roleQueries.one(roleKey));
  const library = useQuery(skillQueries.list());
  if (!role.data) return null;
  const { card } = role.data;
  const skills = library.data ? sessionSkillsOf(role.data, library.data) : [];
  return (
    <div className="person-columns">
      <div className="person-column">
        <PersonBlock icon="user" title={`Who ${card.name} is`}>
          <p className="person-text">{card.responsibilities}</p>
        </PersonBlock>
        <PersonBlock icon="cpu" title="Works with">
          <p className="person-text">
            {modelLabel(card.model)} · effort {EFFORT_LABELS[card.effort].toLowerCase()} ·{" "}
            {taskLimitLabel(card.taskLimit)}
          </p>
          <p className="person-note">
            Session default: {SESSION_DEFAULTS[card.sessionDefault].label}
          </p>
        </PersonBlock>
      </div>
      <div className="person-column">
        <PersonBlock
          icon="sparkles"
          title="Skills"
          actions={
            <Link to="/people/$roleKey/role" params={{ roleKey }} className="person-block-link">
              Role card
            </Link>
          }
        >
          {skills.length > 0 ? (
            <div className="person-skills">
              {skills.map((skill) => (
                <SkillChip key={skill.name} name={skill.name} title={skill.description} />
              ))}
            </div>
          ) : (
            <p className="person-note">None yet.</p>
          )}
        </PersonBlock>
      </div>
    </div>
  );
}
