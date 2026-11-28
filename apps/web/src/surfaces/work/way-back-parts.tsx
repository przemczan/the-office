import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Task, TaskWaysBack } from "@the-office/contracts";
import { CheckboxList } from "@the-office/ui";
import type { ReactNode } from "react";
import { taskQueries } from "../../api/work.ts";
import { useToast } from "../../shell/toasts.tsx";

const RESET_BRANCH = "reset-branch";

/**
 * A way back for a Task (Restart from…, Start over, Reopen…): once sent, the Task, its ways back,
 * its Stages and the board are read again, the toast says what happened and the window closes. A
 * refusal stays in the window, which shows it.
 */
export function useWayBack<Sent>(
  taskId: string,
  send: (sent: Sent) => Promise<Task | void>,
  done: (sent: Sent) => string,
  onDone: () => void,
) {
  const queryClient = useQueryClient();
  const showToast = useToast();
  return useMutation({
    mutationFn: send,
    onSuccess: async (answer, sent) => {
      if (answer) queryClient.setQueryData(taskQueries.one(answer.id).queryKey, answer);
      // Under the Tasks' key: the Task, its ways back, its Stages and History, and the board.
      await queryClient.invalidateQueries({ queryKey: taskQueries.one(taskId).queryKey });
      await queryClient.invalidateQueries(taskQueries.list());
      showToast(done(sent));
      onDone();
    },
  });
}

/**
 * Why the Task's branch isn't reset, when Start over and Reopen… may not reset it (its work has left
 * the workstation); undefined while they may.
 */
export function notResetWhy({ resetBranch }: TaskWaysBack): string | undefined {
  return resetBranch.offered ? undefined : (resetBranch.why ?? "Its branch can't be reset now.");
}

/** Whether the way back resets the branch: only a started Task's, while it may, when checked. */
export function resetsBranch(waysBack: TaskWaysBack, checked: boolean): boolean {
  return waysBack.started && waysBack.resetBranch.offered && checked;
}

/**
 * Whether Start over or Reopen… resets the Task's branch to `resetTo`, the freshly fetched base or
 * its Initiative's branch, keeping the old head under a local ref; asked only of a Task that had
 * started, and left unchecked and disabled, saying why, once it may not be reset.
 */
export function ResetBranchField({
  resetTo,
  checked,
  notReset,
  disabled,
  onChange,
}: {
  readonly resetTo: string;
  readonly checked: boolean;
  /** Why the branch may not be reset, from `notResetWhy`; undefined while it may. */
  readonly notReset: string | undefined;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}): ReactNode {
  const reset = notReset === undefined && checked;
  return (
    <div>
      <CheckboxList
        label="Branch"
        options={[{ value: RESET_BRANCH, label: `Reset the branch to ${resetTo}` }]}
        values={reset ? [RESET_BRANCH] : []}
        disabled={disabled || notReset !== undefined}
        onChange={(values) => onChange(values.includes(RESET_BRANCH))}
      />
      <p className="dialog-hint">
        {notReset !== undefined
          ? `Not reset: ${notReset}`
          : reset
            ? "Its work so far is kept under a local ref, off the branch."
            : "The branch keeps its work so far, and the next start builds on it."}
      </p>
    </div>
  );
}

/** Earlier Stage runs stay readable, set apart from the new start's. */
export const EARLIER_RUNS_STAY =
  "Its earlier Stage runs stay in the Stage history, set apart as an earlier start.";
