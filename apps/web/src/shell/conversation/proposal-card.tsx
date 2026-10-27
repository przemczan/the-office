import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type {
  Preset,
  Proposal,
  ProposalApplication,
  ProposedChange,
  Role,
  RoleCard,
} from "@the-office/contracts";
import { Badge, Button, Icon, Input } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  applyProposal,
  declineProposal,
  sizeThresholdQuery,
  threadQueries,
} from "../../api/conversations.ts";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
import { officeWideLimitQuery } from "../../api/work.ts";
import { EFFORT_LABELS, modelLabel } from "../engine-words.ts";
import { personName } from "../person-name.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import {
  CAPABILITIES,
  ENGINE_LABELS,
  fieldLabel,
  fieldValueText,
  HARD_SWITCH_LABELS,
  hardSwitchValueLabel,
  permissionProfileLines,
  proposedFieldChanges,
  SESSION_DEFAULTS,
  taskLimitLabel,
  type RoleTitles,
} from "../role-card-words.ts";
import { SkillChip } from "../skill-chip.tsx";
import { momentWords } from "../time.ts";
import { useToast } from "../toasts.tsx";
import { tokensShort } from "./context-words.ts";
import "./conversation.css";

type ProposedHire = Extract<ProposedChange, { kind: "hire" }>;
type ProposedPresetHire = Extract<ProposedChange, { kind: "hire-from-preset" }>;
type ProposedRoleChange = Extract<ProposedChange, { kind: "change" }>;
type ProposedSettingChange = Extract<ProposedChange, { kind: OfficeSetting }>;
type OfficeSetting = "office-wide-limit" | "size-threshold";

/** How the card words each Office setting, as Settings › Office limits does. */
const OFFICE_SETTINGS: Record<
  OfficeSetting,
  {
    readonly title: string;
    readonly label: string;
    readonly valueText: (value: number) => string;
    readonly appliesWhen: string;
    readonly query: () => { readonly queryKey: QueryKey };
  }
> = {
  "office-wide-limit": {
    title: "Change the Office-wide limit",
    label: "Running Tasks at once",
    valueText: String,
    appliesWhen: "Applies to the next Start; running Tasks finish",
    query: officeWideLimitQuery,
  },
  "size-threshold": {
    title: "Change the size threshold",
    label: "Size threshold",
    valueText: (tokens) => `${tokensShort(tokens)} tokens`,
    appliesWhen: "Applies from each Thread's next message",
    query: sizeThresholdQuery,
  },
};

/**
 * A Proposal as a card in the drafting person's chat (spec §2.4): a new Role to hire, from scratch
 * (as proposed or edited first on the hire page) or from a preset (under the proposed name or one
 * the user gives), a change to a Role's card, or a new value for an Office setting. Nothing changes
 * until the user applies it; "Not now" declines it.
 */
export function ProposalCard({ proposal }: { readonly proposal: Proposal }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const options = useQuery(roleCardQueries.options()).data;
  const presets = useQuery(roleCardQueries.presets()).data;
  const roleTitles: RoleTitles = new Map(options?.knownRoles.map(({ key, title }) => [key, title]));
  const { change } = proposal;
  switch (change.kind) {
    case "hire":
      return (
        <ProposalFrame title={`New Role · ${change.card.name} · ${change.card.title}`}>
          <ProposedCard card={change.card} roleTitles={roleTitles} />
          <HireFoot proposal={proposal} change={change} />
        </ProposalFrame>
      );
    case "hire-from-preset": {
      const preset = presets?.find(({ roleKey }) => roleKey === change.roleKey);
      const title = preset?.card.title ?? change.roleKey;
      return (
        <ProposalFrame title={`New Role · ${change.name} · ${title}`}>
          {preset && (
            <ProposedCard card={presetCard(preset, change.name)} roleTitles={roleTitles} />
          )}
          <PresetHireFoot proposal={proposal} change={change} title={title} />
        </ProposalFrame>
      );
    }
    case "change":
      return (
        <ProposalFrame title={`Change ${roleName(change.roleKey, roles)}`}>
          <ProposedChanges change={change} roleTitles={roleTitles} />
          <ChangeFoot proposal={proposal} personFirstName={firstName(change.roleKey, roles)} />
        </ProposalFrame>
      );
    case "office-wide-limit":
    case "size-threshold":
      return (
        <ProposalFrame title={OFFICE_SETTINGS[change.kind].title}>
          <ProposedSetting change={change} />
          <SettingFoot proposal={proposal} setting={change.kind} />
        </ProposalFrame>
      );
  }
}

function ProposalFrame({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="message proposal-card" aria-label={`Proposal: ${title}`}>
      <div className="proposal-head">
        <Badge tone="accent">Proposal</Badge>
        <span className="proposal-title">{title}</span>
      </div>
      {children}
    </section>
  );
}

/** The preset's card under the person's name; a preset's Role has only the skills for everyone. */
function presetCard({ card }: Preset, name: string): RoleCard {
  return { ...card, name, skills: [] };
}

/** The new Role's card, read-only, in the few lines a chat has room for. */
function ProposedCard({
  card,
  roleTitles,
}: {
  readonly card: RoleCard;
  readonly roleTitles: RoleTitles;
}): ReactNode {
  const capabilities = CAPABILITIES.filter(({ key }) => card.capabilities[key]);
  return (
    <dl className="proposal-fields">
      <ProposedField label="Responsibilities">{card.responsibilities}</ProposedField>
      <ProposedField label="Instructions">
        <span className="proposal-clamp">{card.instructions}</span>
      </ProposedField>
      <ProposedField label="Capabilities">
        {capabilities.length > 0 ? capabilities.map(({ label }) => label).join(" · ") : "None"}
      </ProposedField>
      <ProposedField label="Task limit">{taskLimitLabel(card.taskLimit)}</ProposedField>
      <ProposedField label="Works with">
        {modelLabel(card.model)} · effort {EFFORT_LABELS[card.effort].toLowerCase()} ·{" "}
        {ENGINE_LABELS[card.engine]}
        <span className="proposal-note">
          Sessions: {SESSION_DEFAULTS[card.sessionDefault].label}
        </span>
      </ProposedField>
      <ProposedField label="Skills">
        {card.skills.length > 0 ? (
          <span className="proposal-skills">
            {card.skills.map((skill) => (
              <SkillChip key={skill} name={skill} />
            ))}
          </span>
        ) : (
          "Only the skills for everyone"
        )}
      </ProposedField>
      <ProposedField label="Permission profile">
        {permissionProfileLines(card.permissionProfile).join(" · ")}
      </ProposedField>
      <ProposedField label="Hard switches">
        {(Object.keys(HARD_SWITCH_LABELS) as (keyof typeof HARD_SWITCH_LABELS)[])
          .map(
            (key) =>
              `${HARD_SWITCH_LABELS[key]}: ${hardSwitchValueLabel(card.hardSwitches[key], roleTitles)}`,
          )
          .join(" · ")}
      </ProposedField>
    </dl>
  );
}

function ProposedField({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="proposal-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Each field the change rewrites, from what the card had when drafted to what is proposed. */
function ProposedChanges({
  change,
  roleTitles,
}: {
  readonly change: ProposedRoleChange;
  readonly roleTitles: RoleTitles;
}): ReactNode {
  return (
    <ul className="proposal-changes">
      {proposedFieldChanges(change.from, change.to).map(({ field, from, to }) => (
        <li key={field}>
          <span className="proposal-change-label">{fieldLabel(field)}</span>
          <span className="proposal-change-from">{fieldValueText(field, from, roleTitles)}</span>
          <Icon name="arrow-right" size={14} aria-label="to" />
          <span className="proposal-change-to">{fieldValueText(field, to, roleTitles)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The setting from its value when drafted to the one proposed. */
function ProposedSetting({ change }: { readonly change: ProposedSettingChange }): ReactNode {
  const { label, valueText } = OFFICE_SETTINGS[change.kind];
  return (
    <ul className="proposal-changes">
      <li>
        <span className="proposal-change-label">{label}</span>
        <span className="proposal-change-from">{valueText(change.from)}</span>
        <Icon name="arrow-right" size={14} aria-label="to" />
        <span className="proposal-change-to">{valueText(change.to)}</span>
      </li>
    </ul>
  );
}

function HireFoot({
  proposal,
  change,
}: {
  readonly proposal: Proposal;
  readonly change: ProposedHire;
}): ReactNode {
  const navigate = useNavigate();
  const showToast = useToast();
  const name = change.card.name;
  const answering = useAnswering(proposal, [roleQueries.list().queryKey], () =>
    showToast(`${personName(change)} hired.`),
  );
  const { status } = proposal;
  return (
    <div className="proposal-foot">
      {status.kind === "applied" && (
        <>
          <Badge tone="success">Hired</Badge>
          <span className="proposal-note">by you · {momentWords(status.at)}</span>
          {change.roleKey !== null && (
            <Link
              className="proposal-link"
              to="/people/$roleKey"
              params={{ roleKey: change.roleKey }}
            >
              Open {name}'s page
            </Link>
          )}
        </>
      )}
      {status.kind === "declined" && <Badge tone="neutral">Not hired</Badge>}
      {status.kind === "open" && (
        <>
          <Button
            size="sm"
            loading={answering.applying.isPending}
            disabled={answering.busy}
            onClick={() => answering.applying.mutate({})}
          >
            Hire {name}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={answering.busy}
            onClick={() => void navigate({ to: "/hire", search: { proposal: proposal.id } })}
          >
            Edit before hiring
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={answering.declining.isPending}
            disabled={answering.busy}
            onClick={() => answering.declining.mutate()}
          >
            Not now
          </Button>
          {answering.error && (
            <RefusalAlert title={`${name} can't be hired yet`} error={answering.error} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Hiring into a preset's Role: under the proposed name, or one the user gives first. A preset's Role
 * is hired on its preset's card, so the name is all there is to edit.
 */
function PresetHireFoot({
  proposal,
  change,
  title,
}: {
  readonly proposal: Proposal;
  readonly change: ProposedPresetHire;
  readonly title: string;
}): ReactNode {
  const showToast = useToast();
  const [editedName, setEditedName] = useState<string>();
  const answering = useAnswering(proposal, [roleQueries.list().queryKey], (applied) => {
    if (applied.change.kind === "hire-from-preset") {
      showToast(`${applied.change.name} · ${title} hired.`);
    }
  });
  const { status } = proposal;
  const name = editedName ?? change.name;
  return (
    <div className="proposal-foot">
      {status.kind === "applied" && (
        <>
          <Badge tone="success">Hired</Badge>
          <span className="proposal-note">by you · {momentWords(status.at)}</span>
          <Link
            className="proposal-link"
            to="/people/$roleKey"
            params={{ roleKey: change.roleKey }}
          >
            Open {change.name}'s page
          </Link>
        </>
      )}
      {status.kind === "declined" && <Badge tone="neutral">Not hired</Badge>}
      {status.kind === "open" && (
        <>
          {editedName !== undefined && (
            <div className="proposal-name">
              <Input
                size="sm"
                label="Name"
                hint="Shown with the title, as in Ada · Developer."
                value={editedName}
                onChange={(event) => setEditedName(event.target.value)}
                autoFocus
              />
            </div>
          )}
          <Button
            size="sm"
            loading={answering.applying.isPending}
            disabled={answering.busy}
            onClick={() =>
              answering.applying.mutate(editedName === undefined ? {} : { name: editedName })
            }
          >
            {name.trim() === "" ? "Hire" : `Hire ${name.trim()}`}
          </Button>
          {editedName === undefined ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={answering.busy}
              onClick={() => setEditedName(change.name)}
            >
              Edit before hiring
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={answering.busy}
              onClick={() => setEditedName(undefined)}
            >
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            loading={answering.declining.isPending}
            disabled={answering.busy}
            onClick={() => answering.declining.mutate()}
          >
            Not now
          </Button>
          {answering.error && (
            <RefusalAlert
              title={`${name.trim() || title} can't be hired yet`}
              error={answering.error}
            />
          )}
        </>
      )}
    </div>
  );
}

function ChangeFoot({
  proposal,
  personFirstName,
}: {
  readonly proposal: Proposal;
  readonly personFirstName: string;
}): ReactNode {
  const showToast = useToast();
  const answering = useAnswering(proposal, [roleQueries.list().queryKey], () =>
    showToast(`Change applied. ${personFirstName} works with it from the next session.`),
  );
  const { status } = proposal;
  return (
    <div className="proposal-foot">
      {status.kind === "applied" && (
        <>
          <Badge tone="success">Applied</Badge>
          <span className="proposal-note">
            by you · {momentWords(status.at)} · {personFirstName} works with it from the next
            session
          </span>
        </>
      )}
      {status.kind === "declined" && <Badge tone="neutral">Not applied</Badge>}
      {status.kind === "open" && (
        <>
          <Button
            size="sm"
            loading={answering.applying.isPending}
            disabled={answering.busy}
            onClick={() => answering.applying.mutate({})}
          >
            Apply change
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={answering.declining.isPending}
            disabled={answering.busy}
            onClick={() => answering.declining.mutate()}
          >
            Not now
          </Button>
          <span className="proposal-note">Applies at {personFirstName}'s next session start</span>
          {answering.error && (
            <RefusalAlert title="The change can't be applied yet" error={answering.error} />
          )}
        </>
      )}
    </div>
  );
}

function SettingFoot({
  proposal,
  setting,
}: {
  readonly proposal: Proposal;
  readonly setting: OfficeSetting;
}): ReactNode {
  const showToast = useToast();
  const { appliesWhen, query } = OFFICE_SETTINGS[setting];
  const answering = useAnswering(proposal, [query().queryKey], () => showToast("Change applied."));
  const { status } = proposal;
  return (
    <div className="proposal-foot">
      {status.kind === "applied" && (
        <>
          <Badge tone="success">Applied</Badge>
          <span className="proposal-note">by you · {momentWords(status.at)}</span>
        </>
      )}
      {status.kind === "declined" && <Badge tone="neutral">Not applied</Badge>}
      {status.kind === "open" && (
        <>
          <Button
            size="sm"
            loading={answering.applying.isPending}
            disabled={answering.busy}
            onClick={() => answering.applying.mutate({})}
          >
            Apply change
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={answering.declining.isPending}
            disabled={answering.busy}
            onClick={() => answering.declining.mutate()}
          >
            Not now
          </Button>
          <span className="proposal-note">{appliesWhen}</span>
          {answering.error && (
            <RefusalAlert title="The change can't be applied yet" error={answering.error} />
          )}
        </>
      )}
    </div>
  );
}

interface ProposalAnswering {
  readonly applying: UseMutationResult<Proposal, Error, ProposalApplication>;
  readonly declining: UseMutationResult<Proposal, Error, void>;
  /** Either is on its way, so neither can be clicked. */
  readonly busy: boolean;
  readonly error: Error | null;
}

/**
 * Applying and declining the Proposal; each refreshes the Thread's log, whose message carries the
 * Proposal as it is now, and applying also what it changed (`changes`). A refusal leaves it open
 * and is shown on the card.
 */
function useAnswering(
  proposal: Proposal,
  changes: readonly QueryKey[],
  onApplied: (applied: Proposal) => void,
): ProposalAnswering {
  const queryClient = useQueryClient();
  const refreshThread = (): Promise<void> =>
    queryClient.invalidateQueries(threadQueries.messages(proposal.threadId));
  const applying = useMutation({
    mutationFn: (application: ProposalApplication) => applyProposal(proposal.id, application),
    onSuccess: async (applied) => {
      onApplied(applied);
      await Promise.all([
        refreshThread(),
        ...changes.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ]);
    },
  });
  const declining = useMutation({
    mutationFn: () => declineProposal(proposal.id),
    onSuccess: refreshThread,
  });
  return {
    applying,
    declining,
    busy: applying.isPending || declining.isPending,
    error: applying.error ?? declining.error,
  };
}

/** The person in a Role, "Ada · Developer"; the key itself when the Role is unknown. */
function roleName(roleKey: string, roles: readonly Role[] | undefined): string {
  const role = roles?.find(({ key }) => key === roleKey);
  return role ? personName(role) : roleKey;
}

function firstName(roleKey: string, roles: readonly Role[] | undefined): string {
  return roles?.find(({ key }) => key === roleKey)?.card.name ?? roleKey;
}
