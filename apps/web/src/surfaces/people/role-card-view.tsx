import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  Effort,
  EngineInCascade,
  Role,
  RoleCardOptions,
  RoleMcpServer,
  Skill,
} from "@the-office/contracts";
import { Badge, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { dutyQueries, roleQueries } from "../../api/people.ts";
import { projectQueries } from "../../api/projects.ts";
import { dutiesHeldBy } from "../../shell/duty-words.ts";
import { EFFORT_LABELS, ENGINE_KIND_ICONS, modelLabel } from "../../shell/engine-words.ts";
import { SkillChip } from "../../shell/skill-chip.tsx";
import { engineTypeRows, noEngineListedWords } from "./engine-type-rows.ts";
import { FixedForTheCaretaker, RoleCardGroup, RoleCardValue } from "./role-card-layout.tsx";
import {
  ASKS_YOU_UNTIL_HIRED,
  CAPABILITIES,
  EACH_ENGINES_DEFAULT,
  ENFORCEMENT_LABELS,
  ENGINES_DEFAULT,
  engineInCascadeText,
  HARD_SWITCH_LABELS,
  hardSwitchValueLabel,
  missingCapabilitiesWords,
  permissionProfileLines,
  roleTitlesOf,
  SESSION_DEFAULTS,
  taskLimitLabel,
  type RoleTitles,
} from "../../shell/role-card-words.ts";
import { useEngineName } from "../../shell/use-engine-name.ts";
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
        <RoleCardValue label="Duties">
          <HeldDuties role={role} />
        </RoleCardValue>
      </RoleCardGroup>
      <RoleCardGroup group="work">
        <RoleCardValue label="Instructions">
          <span className="role-card-instructions">{card.instructions}</span>
        </RoleCardValue>
        <RoleCardValue label="Task limit">
          {taskLimitLabel(card.taskLimit)}
          {role.builtIn && <FixedForTheCaretaker />}
        </RoleCardValue>
        <RoleCardValue label="Session default">
          {SESSION_DEFAULTS[card.sessionDefault].label}
          <span className="role-card-note">
            {SESSION_DEFAULTS[card.sessionDefault].description}
          </span>
        </RoleCardValue>
      </RoleCardGroup>
      <RoleCardGroup group="engine">
        <RoleCardValue label="Works with">
          <WorksWith role={role} options={options} />
        </RoleCardValue>
        {role.letGoAt === null && <EngineThatApplies role={role} options={options} />}
      </RoleCardGroup>
      <RoleCardGroup group="capabilities">
        <ul className="role-card-capabilities">
          {CAPABILITIES.map(({ key, label, hint }) => (
            <li key={key} className={card.capabilities[key] ? "on" : undefined}>
              <Icon name={card.capabilities[key] ? "check" : "minus"} size={14} />
              <span className="role-card-capability-label">{label}</span>
              <span className="role-card-note">{hint}</span>
            </li>
          ))}
        </ul>
        {role.builtIn && <FixedForTheCaretaker />}
      </RoleCardGroup>
      <RoleCardGroup group="permissions">
        <RoleCardValue label="Permission profile">
          {permissionProfileLines(card.permissionProfile).join(" · ")}
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
        {role.builtIn && <FixedForTheCaretaker />}
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
      <RoleCardGroup group="mcpServers">
        {role.mcpServers.length > 0 ? (
          <ul className="role-card-mcp-servers">
            {role.mcpServers.map((server) => (
              <McpServerOnCard key={server.name} server={server} roleTitles={roleTitles} />
            ))}
          </ul>
        ) : (
          <p className="role-card-empty">
            None yet. Add them to the library in{" "}
            <Link to="/settings/mcp-servers">Settings › MCP servers</Link>, then give them to{" "}
            {card.name} with Edit Role.
          </p>
        )}
      </RoleCardGroup>
    </div>
  );
}

/** The duties the person holds, set in Settings › Duties rather than on the card. */
function HeldDuties({ role }: { readonly role: Role }): ReactNode {
  const duties = useQuery(dutyQueries.list());
  if (role.builtIn) {
    return "Holds no duty; it is the one to talk to while nobody holds Default person to talk to.";
  }
  if (!duties.data) return null;
  const held = dutiesHeldBy(duties.data, role.key);
  if (held.length === 0) {
    return (
      <>None. {!role.letGoAt && <Link to="/settings/duties">Change in Settings › Duties</Link>}</>
    );
  }
  return (
    <ul className="role-card-duties">
      {held.map(({ key, label }) => (
        <li key={key}>{label}</li>
      ))}
    </ul>
  );
}

/** The person's model and effort on each engine type listed or set, "Engine's default" muted. */
function WorksWith({
  role,
  options,
}: {
  readonly role: Role;
  readonly options: RoleCardOptions;
}): ReactNode {
  const rows = engineTypeRows(options, role.card.engineSettings);
  if (rows.length === 0) return EACH_ENGINES_DEFAULT;
  const muted = <span className="role-card-muted">{ENGINES_DEFAULT}</span>;
  return (
    <table className="role-card-works-with">
      <thead>
        <tr>
          <th scope="col">Engine type</th>
          <th scope="col">Model</th>
          <th scope="col">Effort</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ type, label, listed, efforts, setting }) => (
          <tr key={type}>
            <th scope="row">
              <span className="role-card-engine-type-name">
                <Icon name={ENGINE_KIND_ICONS[type]} size={14} />
                {label}
              </span>
              {!listed && <span className="role-card-note">{noEngineListedWords(type)}</span>}
            </th>
            <td>{setting?.model ? modelLabel(setting.model) : muted}</td>
            <td>{effortCell(efforts.length > 0, setting?.effort ?? null, muted)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The Effort a row shows: its value, "Engine's default" muted, or nothing for a type taking none. */
function effortCell(takesEffort: boolean, effort: Effort | null, muted: ReactNode): ReactNode {
  if (effort !== null) return EFFORT_LABELS[effort];
  return takesEffort ? muted : null;
}

/**
 * Where the person runs outside any Project, with the model and effort they work with there and
 * what that engine can't do, and the Projects where another engine, model or effort applies.
 */
function EngineThatApplies({
  role,
  options,
}: {
  readonly role: Role;
  readonly options: RoleCardOptions;
}): ReactNode {
  const cascade = useQuery(roleQueries.engineCascade(role.key)).data;
  const projects = useQuery(projectQueries.list()).data;
  const engineName = useEngineName();
  if (!cascade) return null;
  const projectName = (projectId: string): string =>
    projects?.find(({ id }) => id === projectId)?.name ?? projectId;
  const outside = cascade.outsideProjects;
  const missing = outside
    ? options.engines.find(({ engine }) => engine === outside.engineId)?.missingCapabilities
    : undefined;
  const cantDo = missing && missingCapabilitiesWords(missing);
  return (
    <RoleCardValue label="Runs on">
      {outside
        ? engineInCascadeText(outside, engineName)
        : "No engine: add one in Settings › Engines"}
      {cantDo && <span className="role-card-note">{cantDo}</span>}
      {cascade.elsewhereInProjects.length > 0 && (
        <ul className="role-card-elsewhere" aria-label="Projects where something else applies">
          {cascade.elsewhereInProjects.map((inProject) => (
            <li key={inProject.projectId}>
              In {projectName(inProject.projectId)}: {engineInCascadeText(inProject, engineName)}
              {projectSource(inProject, role.card.name)}
            </li>
          ))}
        </ul>
      )}
    </RoleCardValue>
  );
}

/** ", forced by the Project" or ", from the Project's setting for Pam": what a Project sets. */
function projectSource(inProject: EngineInCascade, name: string): string {
  const levels = [
    inProject.modelLevel,
    ...(inProject.effort === null ? [] : [inProject.effortLevel]),
  ];
  if (levels.includes("projectForce")) return ", forced by the Project";
  if (levels.includes("projectPerson")) return `, from the Project's setting for ${name}`;
  return "";
}

/** A server the Role has: on, with each tool's setting, or off, when no session gets it. */
function McpServerOnCard({
  server,
  roleTitles,
}: {
  readonly server: RoleMcpServer;
  readonly roleTitles: RoleTitles;
}): ReactNode {
  return (
    <li aria-label={`MCP server ${server.name}`}>
      <div className="role-card-mcp-server-name">
        <code>{server.name}</code>
        <Badge size="sm" tone={server.on ? "success" : "neutral"}>
          {server.on ? "On" : "Off"}
        </Badge>
      </div>
      {server.on ? (
        <ul className="role-card-switches">
          {server.tools.map((tool) => (
            <li key={tool.name}>
              <span className="role-card-switch-name">{tool.name}</span>
              <span>{hardSwitchValueLabel(tool.setting, roleTitles)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="role-card-note">Off: no session gets it until it is on</span>
      )}
    </li>
  );
}
