import { Link } from "@tanstack/react-router";
import type { Role, RoleCardOptions, Skill } from "@the-office/contracts";
import { Badge, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { EFFORT_LABELS, modelLabel } from "../../shell/engine-words.ts";
import { SkillChip } from "../../shell/skill-chip.tsx";
import { RoleCardGroup, RoleCardValue } from "./role-card-layout.tsx";
import {
  ASKS_YOU_UNTIL_HIRED,
  CAPABILITIES,
  ENFORCEMENT_LABELS,
  ENGINE_LABELS,
  HARD_SWITCH_LABELS,
  hardSwitchValueLabel,
  permissionProfileLines,
  roleTitlesOf,
  SESSION_DEFAULTS,
  SHARED_MEMORY_OFF,
  taskLimitLabel,
} from "./role-card-labels.ts";
import { sessionSkillsOf } from "./session-skills.ts";

/** Every setting of a Role card, read-only, grouped as its form groups them. */
export function RoleCardView({
  role,
  options,
  library,
}: {
  readonly role: Role;
  readonly options: RoleCardOptions;
  readonly library: readonly Skill[];
}): ReactNode {
  const { card } = role;
  const roleTitles = roleTitlesOf(options);
  const skills = sessionSkillsOf(role, library);
  return (
    <div className="role-card">
      <RoleCardGroup group="identity">
        <RoleCardValue label="Name and title">
          {card.name} · {card.title}
        </RoleCardValue>
        <RoleCardValue label="Responsibilities">{card.responsibilities}</RoleCardValue>
      </RoleCardGroup>
      <RoleCardGroup group="work">
        <RoleCardValue label="Instructions">
          <span className="role-card-instructions">{card.instructions}</span>
        </RoleCardValue>
        <RoleCardValue label="Task limit">{taskLimitLabel(card.taskLimit)}</RoleCardValue>
        <RoleCardValue label="Session default">
          {SESSION_DEFAULTS[card.sessionDefault].label}
          <span className="role-card-note">
            {SESSION_DEFAULTS[card.sessionDefault].description}
          </span>
        </RoleCardValue>
      </RoleCardGroup>
      <RoleCardGroup group="engine">
        <RoleCardValue label="Works with">
          {modelLabel(card.model)} · effort {EFFORT_LABELS[card.effort].toLowerCase()} ·{" "}
          {ENGINE_LABELS[card.engine]}
        </RoleCardValue>
      </RoleCardGroup>
      <RoleCardGroup group="capabilities">
        <ul className="role-card-capabilities">
          {CAPABILITIES.map(({ key, label, hint }) => (
            <li key={key} className={card.capabilities[key] ? "on" : undefined}>
              <Icon name={card.capabilities[key] ? "check" : "minus"} size={14} />
              <span className="role-card-capability-label">{label}</span>
              <span className="role-card-note">
                {key === "sharedMemory" ? SHARED_MEMORY_OFF : hint}
              </span>
            </li>
          ))}
        </ul>
      </RoleCardGroup>
      <RoleCardGroup group="permissions">
        <RoleCardValue label="Permission profile">
          {permissionProfileLines(card.permissionProfile).join(" · ")}
          <span className="role-card-note">Set by the preset; read-only for now.</span>
        </RoleCardValue>
        <RoleCardValue label="Hard switches">
          <ul className="role-card-switches">
            {options.hardSwitches.map(({ key, enforcement }) => (
              <li key={key}>
                <span className="role-card-switch-name">{HARD_SWITCH_LABELS[key]}</span>
                <span>
                  {hardSwitchValueLabel(card.hardSwitches[key], roleTitles)}
                  {role.askingYouUntilHired.includes(key) && (
                    <span className="role-card-note">{ASKS_YOU_UNTIL_HIRED}</span>
                  )}
                </span>
                <Badge size="sm" tone={enforcement === "enforced" ? "info" : "neutral"}>
                  {ENFORCEMENT_LABELS[enforcement]}
                </Badge>
              </li>
            ))}
          </ul>
        </RoleCardValue>
      </RoleCardGroup>
      <RoleCardGroup group="skills">
        {skills.length > 0 ? (
          <div className="person-skills">
            {skills.map((skill) => (
              <SkillChip key={skill.name} name={skill.name} title={skill.description} />
            ))}
          </div>
        ) : (
          <p className="role-card-empty">
            None yet. Give {card.name} skills from the library here or in{" "}
            <Link to="/settings/skills">Settings › Skills</Link>.
          </p>
        )}
      </RoleCardGroup>
    </div>
  );
}
