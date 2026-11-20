import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { StandInChoice, StandInSwitchResult } from "@the-office/contracts";
import { Badge, Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { standInChoiceQueries, switchToStandIn } from "../../api/pipelines.ts";
import { ItemCard } from "../item-card.tsx";
import { RefusalAlert } from "../refusal-alert.tsx";
import { clockOf } from "../time.ts";
import { useNotices } from "../toasts.tsx";
import { NeedsYouList } from "../work/needs-you-list.tsx";
import {
  choiceName,
  contextSizeWords,
  leftWithoutGoingOn,
  ranOutWords,
  shownChoices,
  STAND_IN_CHOICE_TITLE,
  standInContextLine,
  standInWords,
  SWITCH_ALL_NOW,
  SWITCH_NOW,
  waitsForResetWords,
  whySwitchAllDisabled,
  whySwitchDisabled,
  type ChoiceNarrowing,
} from "./stand-in-choice-words.ts";
import "./stand-in-choice.css";

/**
 * The Office's own Decision on the Stages held as their engine's usage window was used up, whose
 * context is over the size Settings › Engines asks first above (spec 5.4): one card in Needs you
 * for them all, narrowed to the Projects the filter shows (`projectShown`) or to one Task
 * (`taskId`). Nothing while none waits there.
 */
export function StandInChoiceCard(narrowing: ChoiceNarrowing): ReactNode {
  const choices = useShownChoices(narrowing);
  if (!choices || choices.length === 0) return null;
  return (
    <ItemCard edge="decision" label={STAND_IN_CHOICE_TITLE}>
      <div className="needs-you-item">
        <div className="needs-you-heading">
          <span className="needs-you-title">{STAND_IN_CHOICE_TITLE}</span>
        </div>
        <NeedsYouList>
          <StandInChoiceDecision choices={choices} onTask={false} />
        </NeedsYouList>
      </div>
    </ItemCard>
  );
}

/**
 * The same Decision on a Task's page, among what waits on the user there: only that Task's Stages,
 * and nothing while none of them waits.
 */
export function StandInChoiceOnTask({ taskId }: { readonly taskId: string }): ReactNode {
  const choices = useShownChoices({ taskId });
  if (!choices || choices.length === 0) return null;
  return <StandInChoiceDecision choices={choices} onTask />;
}

/** The Stages waiting for the user's choice, narrowed as asked; undefined until read. */
export function useShownChoices(narrowing: ChoiceNarrowing): readonly StandInChoice[] | undefined {
  const choices = useQuery(standInChoiceQueries.list()).data;
  return choices && shownChoices(choices, narrowing);
}

/**
 * The Decision's body: why it asks, then a row per Stage with Switch now, and Switch all now for
 * two or more. Each switch's result shows beside its Stage while the Stage is still listed.
 */
function StandInChoiceDecision({
  choices,
  onTask,
}: {
  readonly choices: readonly StandInChoice[];
  /** On the Task's page, which names the Task already. */
  readonly onTask: boolean;
}): ReactNode {
  const { results, switching } = useSwitching();
  const oldest = choices.reduce<string | undefined>(
    (first, { waitingSince }) =>
      first === undefined || waitingSince < first ? waitingSince : first,
    undefined,
  );
  const whyAllDisabled = whySwitchAllDisabled(choices, switching.isPending);
  return (
    <section className="message stand-in-choice" aria-label={STAND_IN_CHOICE_TITLE}>
      <div className="message-by">
        <Badge tone="warning">Decision</Badge>
        The Office
        {oldest !== undefined && <span className="needs-you-time">{clockOf(oldest)}</span>}
      </div>
      {onTask && <div className="message-text decision-question">{STAND_IN_CHOICE_TITLE}</div>}
      <p className="decision-context">{standInContextLine(choices)}</p>
      <ul className="stand-in-choice-rows">
        {choices.map((choice) => (
          <ChoiceRow
            key={choice.runId}
            choice={choice}
            onTask={onTask}
            result={results.get(choice.runId)}
            switching={switching.isPending}
            onSwitch={() => switching.mutate([choice])}
          />
        ))}
      </ul>
      {choices.length >= 2 && (
        <div className="stand-in-choice-actions">
          <Button
            variant="accent"
            loading={switching.isPending}
            disabled={whyAllDisabled !== undefined}
            title={whyAllDisabled}
            onClick={() => switching.mutate(choices)}
          >
            {SWITCH_ALL_NOW}
          </Button>
        </div>
      )}
      {switching.error && <RefusalAlert title="The switch didn't happen" error={switching.error} />}
    </section>
  );
}

/**
 * Switch now on the choices given, keeping each result to show beside its row. A Stage whose
 * result takes it off the card without its going on, such as a session moved whose Task couldn't
 * resume, is told in a notice instead, as its row is gone once the list is read again.
 */
function useSwitching(): {
  readonly results: ReadonlyMap<string, StandInSwitchResult>;
  readonly switching: UseMutationResult<
    readonly StandInSwitchResult[],
    Error,
    readonly StandInChoice[]
  >;
} {
  const queryClient = useQueryClient();
  const notices = useNotices();
  const [results, setResults] = useState<ReadonlyMap<string, StandInSwitchResult>>(new Map());
  const switching = useMutation({
    mutationFn: (choices: readonly StandInChoice[]) =>
      switchToStandIn(choices.map(({ runId }) => runId)),
    onSuccess: (answered, choices) => {
      setResults((earlier) => new Map([...earlier, ...answered.map((r) => [r.runId, r] as const)]));
      for (const result of answered.filter(leftWithoutGoingOn)) {
        const choice = choices.find(({ runId }) => runId === result.runId);
        if (choice) {
          notices.show({
            key: `stand-in-switch-${result.runId}`,
            title: choiceName(choice),
            description: result.words,
          });
        }
      }
      void queryClient.invalidateQueries({ queryKey: standInChoiceQueries.list().queryKey });
    },
  });
  return { results, switching };
}

function ChoiceRow({
  choice,
  onTask,
  result,
  switching,
  onSwitch,
}: {
  readonly choice: StandInChoice;
  readonly onTask: boolean;
  readonly result: StandInSwitchResult | undefined;
  readonly switching: boolean;
  readonly onSwitch: () => void;
}): ReactNode {
  const whyDisabled = whySwitchDisabled(choice, switching);
  return (
    <li className="stand-in-choice-row" aria-label={choiceName(choice)}>
      <div className="stand-in-choice-what">
        <div className="stand-in-choice-names">
          {!onTask && (
            <Link to="/tasks/$taskId" params={{ taskId: choice.taskId }}>
              {choice.taskTitle}
            </Link>
          )}
          <strong>{choice.stageName}</strong>
          <span className="stand-in-choice-faint">{contextSizeWords(choice)}</span>
        </div>
        <div className="stand-in-choice-facts">
          {ranOutWords(choice)} · {standInWords(choice)}
        </div>
        <div className="stand-in-choice-outcome" role="status">
          {result ? result.words : waitsForResetWords(choice)}
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={whyDisabled !== undefined}
        title={whyDisabled}
        onClick={onSwitch}
      >
        {SWITCH_NOW}
      </Button>
    </li>
  );
}
