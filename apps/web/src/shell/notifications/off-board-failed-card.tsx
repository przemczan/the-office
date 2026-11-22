import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type {
  Decision,
  DecisionFormAnswer,
  NeedsYouItem,
  Project,
  QuestionAnswer,
} from "@the-office/contracts";
import { Badge, Button, Tooltip } from "@the-office/ui";
import type { ReactNode } from "react";
import { answerDecision, decisionQueries } from "../../api/conversations.ts";
import { ItemCard } from "../item-card.tsx";
import { ProjectChip } from "../project-chip.tsx";
import { durationWords } from "../time.ts";
import { useToast } from "../toasts.tsx";

type OffBoardDecisionItem = Extract<NeedsYouItem, { kind: "decision" }> & {
  readonly offBoardTask: NonNullable<Extract<NeedsYouItem, { kind: "decision" }>["offBoardTask"]>;
};

export const OFF_BOARD_TASK_FAILED = "Off-board Task failed";
export const RETRY = "Retry";
export const OPEN_THE_DECISION = "Open the Decision";

export function failedLineWords(stageName: string): string {
  return `${stageName} failed, and its rounds are used up.`;
}

export function retryHintWords(stageName: string): string {
  return `Retry runs ${stageName} again, with the failure in its Brief.`;
}

/** "12 min ago", from when it began waiting on the user. */
export function agoWords(isoTime: string, now: Date = new Date()): string {
  return `${durationWords(now.getTime() - new Date(isoTime).getTime())} ago`;
}

/**
 * Retry's answer: the out-of-tries Decision's first option, with no guidance, to every question it
 * asks (it asks one).
 */
export function retryAnswer(decision: Pick<Decision, "questions">): DecisionFormAnswer {
  return {
    kind: "submitted",
    answers: decision.questions.map((question): QuestionAnswer => {
      switch (question.kind) {
        case "choice":
          return { kind: "option", option: 0 };
        case "choice-of-several":
          return { kind: "options", options: [0] };
        case "open":
          return { kind: "words", text: "" };
      }
    }),
  };
}

/**
 * An Off-board Task's out-of-tries Decision once it is the user's, in place of its Decision card
 * (docs/design/set-up-tasks.html, Now): what failed and its error, Retry, which answers the
 * Decision with its first option, and Open the Decision, for guidance, Continue or Drop.
 */
export function OffBoardFailedCard({
  item,
  projects,
}: {
  readonly item: OffBoardDecisionItem;
  readonly projects: readonly Project[] | undefined;
}): ReactNode {
  const { offBoardTask } = item;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const decision = useQuery(decisionQueries.open()).data?.find(({ id }) => id === item.decisionId);
  const retrying = useMutation({
    mutationFn: (asked: Decision) => answerDecision(asked.id, retryAnswer(asked)),
    onSuccess: () => {
      void queryClient.invalidateQueries(decisionQueries.open());
      void queryClient.invalidateQueries(decisionQueries.unanswered(item.taskId));
    },
    onError: (error) => showToast(error.message),
  });
  return (
    <ItemCard edge="failed" label={`${OFF_BOARD_TASK_FAILED}: ${offBoardTask.title}`}>
      <div className="needs-you-item off-board-failed">
        <div>
          <Badge tone="danger" size="sm">
            {OFF_BOARD_TASK_FAILED}
          </Badge>
        </div>
        <div className="needs-you-heading">
          <Link to="/tasks/$taskId" params={{ taskId: item.taskId }} className="needs-you-title">
            {offBoardTask.title}
          </Link>
          <ProjectChip projectId={item.projectId} projects={projects} />
          <span className="needs-you-time">{agoWords(item.waitingSince)}</span>
        </div>
        <div className="off-board-failed-line">{failedLineWords(offBoardTask.stageName)}</div>
        {offBoardTask.error !== null && (
          <pre className="off-board-failed-error">{offBoardTask.error}</pre>
        )}
        <div className="off-board-failed-actions">
          <Tooltip content={retryHintWords(offBoardTask.stageName)}>
            <Button
              variant="primary"
              size="sm"
              disabled={!decision || retrying.isPending}
              loading={retrying.isPending}
              onClick={() => decision && retrying.mutate(decision)}
            >
              {RETRY}
            </Button>
          </Tooltip>
          <Link
            className="link-button"
            to="/tasks/$taskId"
            params={{ taskId: item.taskId }}
            search={{ decision: item.decisionId }}
          >
            {OPEN_THE_DECISION}
          </Link>
        </div>
      </div>
    </ItemCard>
  );
}

/** Whether a Needs you item is an Off-board Task's failure, which this card shows. */
export function isOffBoardFailure(item: NeedsYouItem): item is OffBoardDecisionItem {
  return item.kind === "decision" && item.offBoardTask !== null;
}
