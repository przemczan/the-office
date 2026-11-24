import type { Task, TaskStages, TaskWaysBack } from "@the-office/contracts";
import { act, Fragment, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { decisionQueries } from "../../api/conversations.ts";
import { roleQueries } from "../../api/people.ts";
import { pipelineQueries } from "../../api/pipelines.ts";
import { taskQueries } from "../../api/work.ts";
import { buttonNamed } from "../../shell/page.fixtures.tsx";
import {
  aWaysBack,
  rendered,
  TASK,
  unmounted,
} from "../../shell/work/way-back-dialogs.fixtures.tsx";
import { RecordActionButton } from "./record-actions.tsx";
import { useReopenAction } from "./reopen-action.tsx";
import { useRunControlActions } from "./run-controls.tsx";

const PAUSED = { ...TASK, state: "paused", pausedBy: null } as Task;
const STAGES = { stages: [], definitionOfDoneMet: [] } as unknown as TaskStages;

/** The actions as the head shows them, with the window one opened. */
function Actions({ task }: { readonly task: Task }): ReactNode {
  const actions = useRunControlActions(task);
  const reopen = useReopenAction(task);
  return (
    <>
      {[...actions, ...(reopen ? [reopen] : [])].map((action) => (
        <Fragment key={action.key}>
          <RecordActionButton action={action} />
          {action.dialog}
        </Fragment>
      ))}
    </>
  );
}

function open(task: Task, waysBack: TaskWaysBack = aWaysBack()): void {
  rendered(<Actions task={task} />, (queryClient) => {
    queryClient.setQueryData(taskQueries.waysBack(task.id).queryKey, waysBack);
    queryClient.setQueryData(pipelineQueries.taskStages(task.id).queryKey, STAGES);
    queryClient.setQueryData(roleQueries.list().queryKey, []);
    queryClient.setQueryData(decisionQueries.open().queryKey, []);
  });
}

function shown(name: string): HTMLButtonElement {
  const button = buttonNamed(document.body, name);
  if (!button) throw new Error(`There is no ${name}.`);
  return button;
}

describe("the ways back beside Resume", () => {
  afterEach(unmounted);

  it("offers Restart from… and Start over on a Task the user paused", () => {
    open(PAUSED);

    expect(shown("Restart from…").disabled).toBe(false);
    expect(shown("Start over").disabled).toBe(false);
  });

  it("disables one the service doesn't offer, saying why on hover", () => {
    open(
      PAUSED,
      aWaysBack({ startOver: { offered: false, why: "A Publish Stage has already run." } }),
    );

    expect(shown("Start over").disabled).toBe(true);
    expect(shown("Start over").title).toBe("A Publish Stage has already run.");
  });

  it("offers neither on a Task something else paused", () => {
    open({ ...PAUSED, pausedBy: "alarm" });

    expect(buttonNamed(document.body, "Restart from…")).toBeUndefined();
    expect(buttonNamed(document.body, "Start over")).toBeUndefined();
  });

  it("opens each one's window", () => {
    open(PAUSED);

    act(() => shown("Restart from…").click());
    expect(document.body.textContent).toContain(`Restart ${TASK.title} from…`);

    act(() => shown("Start over").click());
    expect(document.body.textContent).toContain(`Start ${TASK.title} over?`);
  });

  it("offers Reopen… on a Dropped Task only, opening its window", () => {
    open(PAUSED);
    expect(buttonNamed(document.body, "Reopen…")).toBeUndefined();
    unmounted();

    open({ ...TASK, state: "dropped" } as Task);
    act(() => shown("Reopen…").click());

    expect(document.body.textContent).toContain(`Reopen ${TASK.title}?`);
  });

  it("disables Reopen… while it isn't offered, saying why", () => {
    open(
      { ...TASK, state: "dropped" } as Task,
      aWaysBack({ reopen: { offered: false, why: "Its Project was removed." } }),
    );

    expect(shown("Reopen…").disabled).toBe(true);
    expect(shown("Reopen…").title).toBe("Its Project was removed.");
  });
});
