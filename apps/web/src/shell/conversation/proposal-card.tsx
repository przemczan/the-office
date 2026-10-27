import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type {
  Proposal,
  ProposalApplication,
  ProposedChange,
  Role,
  RoleCard,
} from "@the-office/contracts";
import { Badge, Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { applyProposal, declineProposal, threadQueries } from "../../api/conversations.ts";
import { roleCardQueries, roleQueries } from "../../api/people.ts";
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
import "./conversation.css";

type ProposedHire = Extract<ProposedChange, { kind: "hire" }>;
type ProposedRoleChange = Extract<ProposedChange, { kind: "change" }>;

/**
 * A Proposal as a card in the drafting person's chat (spec §2.4): a new Role to hire, as proposed or
 * edited first on the hire page, or a change to a Role's card. Nothing changes until the user
 * applies it; "Not now" declines it.
 */
export function ProposalCard({ proposal }: { readonly proposal: Proposal }): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const options = useQuery(roleCardQueries.options()).data;
  const roleTitles: RoleTitles = new Map(options?.knownRoles.map(({ key, title }) => [key, title]));
  const { change } = proposal;
  const title =
    change.kind === "hire"
      ? `New Role · ${change.card.name} · ${change.card.title}`
      : `Change ${roleName(change.roleKey, roles)}`;
  return (
    <section className="message proposal-card" aria-label={`Proposal: ${title}`}>
      <div className="proposal-head">
        <Badge tone="accent">Proposal</Badge>
        <span className="proposal-title">{title}</span>
      </div>
      {change.kind === "hire" ? (
        <>
          <ProposedCard card={change.card} roleTitles={roleTitles} />
          <HireFoot proposal={proposal} change={change} />
        </>
      ) : (
        <>
          <ProposedChanges change={change} roleTitles={roleTitles} />
          <ChangeFoot proposal={proposal} personFirstName={firstName(change.roleKey, roles)} />
        </>
      )}
    </section>
  );
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
  const answering = useAnswering(proposal, () => showToast(`${personName(change)} hired.`));
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

function ChangeFoot({
  proposal,
  personFirstName,
}: {
  readonly proposal: Proposal;
  readonly personFirstName: string;
}): ReactNode {
  const showToast = useToast();
  const answering = useAnswering(proposal, () =>
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

interface ProposalAnswering {
  readonly applying: UseMutationResult<Proposal, Error, ProposalApplication>;
  readonly declining: UseMutationResult<Proposal, Error, void>;
  /** Either is on its way, so neither can be clicked. */
  readonly busy: boolean;
  readonly error: Error | null;
}

/**
 * Applying and declining the Proposal; each refreshes the Thread's log, whose message carries the
 * Proposal as it is now. A refusal leaves it open and is shown on the card.
 */
function useAnswering(proposal: Proposal, onApplied: () => void): ProposalAnswering {
  const queryClient = useQueryClient();
  const refreshThread = (): Promise<void> =>
    queryClient.invalidateQueries(threadQueries.messages(proposal.threadId));
  const applying = useMutation({
    mutationFn: (application: ProposalApplication) => applyProposal(proposal.id, application),
    onSuccess: async () => {
      onApplied();
      await Promise.all([refreshThread(), queryClient.invalidateQueries(roleQueries.list())]);
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
