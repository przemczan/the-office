import {
  runPermissionSchema,
  type HardSwitchValue,
  type Role,
  type RoleCardOptions,
} from "@the-office/contracts";
import { Field, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  editLabel,
  hardSwitchChoiceOf,
  hardSwitchValueLabel,
  hardSwitchValueOf,
  mcpToolKey,
  roleTitlesOf,
  RUN_LABELS,
  webLabel,
  type RoleTitles,
} from "../role-card-words.ts";
import { TagsInput } from "../work/tags-input.tsx";
import type { AgentStage } from "./stage-edits.ts";
import {
  narrowerRuns,
  narrowerSettings,
  withCommands,
  withMcpToolSetting,
  withPermissions,
} from "./stage-permissions.ts";

/** A Select's value for "as the Role card says": the Stage leaves it out. */
const ROLE_CARD = "";

const READS_ONLY = "reads-only";
const NO_WEB = "no-web";

interface StagePermissionFieldsProps {
  readonly stage: AgentStage;
  /** Who works the Stage; undefined while nobody does, when there is no card to narrow. */
  readonly role: Role | undefined;
  readonly options: RoleCardOptions;
  /** The Projects' command keys, suggested for the Stage's Project commands. */
  readonly commandKeys: readonly string[];
  readonly change: (stage: AgentStage) => void;
}

/**
 * The Stage's narrowing of its Role card's permission profile (spec §6): each part offers only
 * what is narrower than the card, so a Stage can't widen it. Its Project commands may name a key
 * no Project has; the service refuses it once a Pipeline naming it is chosen.
 */
export function StagePermissionFields({
  stage,
  role,
  options,
  commandKeys,
  change,
}: StagePermissionFieldsProps): ReactNode {
  if (!role) return null;
  const profile = role.card.permissionProfile;
  const permissions = stage.permissions ?? {};
  const roleTitles = roleTitlesOf(options);
  const consultable = options.knownRoles.map(({ key }) => key).filter((key) => key !== role.key);
  const tools = role.mcpServers.flatMap((server) =>
    server.tools.map((tool) => ({ key: mcpToolKey(server.name, tool.name), card: tool.setting })),
  );
  return (
    <div className="stage-editor-wide">
      <Field
        label="Permission profile"
        hint="Narrows the Role card's for this Stage, never widens it"
      >
        <div className="stage-editor-permissions">
          <Select
            label="Files"
            value={permissions.edit === false ? READS_ONLY : ROLE_CARD}
            options={[
              { value: ROLE_CARD, label: cardDefault(editLabel(profile.edit)) },
              ...(profile.edit || permissions.edit === false
                ? [{ value: READS_ONLY, label: editLabel(false) }]
                : []),
            ]}
            onChange={(choice) =>
              change(withPermissions(stage, { edit: choice === READS_ONLY ? false : undefined }))
            }
          />
          <Select
            label="Runs"
            value={permissions.run ?? ROLE_CARD}
            options={[
              { value: ROLE_CARD, label: cardDefault(RUN_LABELS[profile.run]) },
              ...withCurrent(narrowerRuns(profile.run), permissions.run).map((run) => ({
                value: run,
                label: RUN_LABELS[run],
              })),
            ]}
            onChange={(choice) =>
              change(withPermissions(stage, { run: runPermissionSchema.safeParse(choice).data }))
            }
          />
          <Select
            label="Web"
            value={permissions.web === false ? NO_WEB : ROLE_CARD}
            options={[
              { value: ROLE_CARD, label: cardDefault(webLabel(profile.web)) },
              ...(profile.web || permissions.web === false
                ? [{ value: NO_WEB, label: webLabel(false) }]
                : []),
            ]}
            onChange={(choice) =>
              change(withPermissions(stage, { web: choice === NO_WEB ? false : undefined }))
            }
          />
          {tools.map(({ key, card }) => (
            <McpToolSelect
              key={key}
              toolKey={key}
              card={card}
              setting={permissions.mcpTools?.[key]}
              consultable={consultable}
              roleTitles={roleTitles}
              onChange={(setting) => change(withMcpToolSetting(stage, key, setting))}
            />
          ))}
          <div className="stage-editor-wide">
            <Field
              label="Project commands"
              hint="Only these of the Project's commands; never install"
            >
              <TagsInput
                label="Project commands"
                addLabel="Add a Project command"
                placeholder={
                  permissions.commands === undefined
                    ? cardDefault("every Project command")
                    : "Add a Project command"
                }
                tags={permissions.commands ?? []}
                suggestions={commandKeys}
                onChange={(keys) => change(withCommands(stage, keys))}
              />
            </Field>
          </div>
        </div>
      </Field>
    </div>
  );
}

function McpToolSelect({
  toolKey,
  card,
  setting,
  consultable,
  roleTitles,
  onChange,
}: {
  readonly toolKey: string;
  readonly card: HardSwitchValue;
  readonly setting: HardSwitchValue | undefined;
  readonly consultable: readonly string[];
  readonly roleTitles: RoleTitles;
  readonly onChange: (setting: HardSwitchValue | undefined) => void;
}): ReactNode {
  const narrower = narrowerSettings(card, consultable);
  const offered =
    setting && !narrower.some((each) => hardSwitchChoiceOf(each) === hardSwitchChoiceOf(setting))
      ? [...narrower, setting]
      : narrower;
  return (
    <Select
      label={`MCP tool ${toolKey}`}
      value={setting ? hardSwitchChoiceOf(setting) : ROLE_CARD}
      options={[
        { value: ROLE_CARD, label: cardDefault(hardSwitchValueLabel(card, roleTitles)) },
        ...offered.map((value) => ({
          value: hardSwitchChoiceOf(value),
          label: hardSwitchValueLabel(value, roleTitles),
        })),
      ]}
      onChange={(choice) => onChange(choice === ROLE_CARD ? undefined : hardSwitchValueOf(choice))}
    />
  );
}

function cardDefault(words: string): string {
  return `Role default: ${words}`;
}

/** The choices with the Stage's current one kept listed, so a wider one shows instead of vanishing. */
function withCurrent<Choice>(choices: readonly Choice[], current: Choice | undefined): Choice[] {
  return current === undefined || choices.includes(current) ? [...choices] : [...choices, current];
}
