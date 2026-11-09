import type { Initiative } from "@the-office/contracts";
import { Button, Icon, IconButton, Menu, type MenuItem } from "@the-office/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { confirmInitiative, dropInitiative, taskQueries } from "../../api/work.ts";
import { useCopyRecordLink } from "../../shell/copy-record-link.ts";
import { useToast } from "../../shell/toasts.tsx";
import { NewTaskDialog } from "../../shell/work/new-task-dialog.tsx";
import { usePlanner } from "../../shell/work/use-planner.ts";
import { canHoldBack } from "./dependency-words.ts";
import { droppedWords, tasksOfInitiative } from "./initiative-words.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";

/**
 * The Initiative page's head actions (prototypes/app/work.js `initiativePage`): "Confirm the
 * Initiative" while shaping, "Add a Task" while it is open, and its menu with Drop.
 */
export function InitiativeActions({ initiative }: { readonly initiative: Initiative }): ReactNode {
  const [adding, setAdding] = useState(false);
  const tasks = useQuery(taskQueries.list());
  const open = initiative.state === "shaping" || initiative.state === "active";
  return (
    <>
      {initiative.state === "shaping" && <ConfirmButton initiative={initiative} />}
      {open && (
        <Button
          variant="secondary"
          iconLeft={<Icon name="plus" size={14} />}
          onClick={() => setAdding(true)}
        >
          Add a Task
        </Button>
      )}
      <InitiativeMenu initiative={initiative} />
      {adding && (
        <NewTaskDialog
          initiative={initiative}
          canWaitFor={tasksOfInitiative(initiative, tasks.data ?? []).filter(canHoldBack)}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}

function ConfirmButton({ initiative }: { readonly initiative: Initiative }): ReactNode {
  const showToast = useToast();
  const planner = usePlanner()?.card.name;
  const confirming = useInitiativeChange(
    initiative,
    () => confirmInitiative(initiative.id),
    (confirmed) => showToast(confirmedWords(confirmed, planner)),
  );
  return (
    <Button
      iconLeft={<Icon name="check" size={14} />}
      loading={confirming.isPending}
      onClick={() => confirming.mutate(undefined, { onError: (error) => showToast(error.message) })}
    >
      Confirm the Initiative
    </Button>
  );
}

function confirmedWords(confirmed: Initiative, planner: string | undefined): string {
  if (confirmed.state === "done") return "Initiative confirmed, and done: its Tasks are.";
  const until = planner ? `${planner} plans them` : "they are planned";
  return `Initiative confirmed. Its Tasks moved to Backlog, to wait until ${until}.`;
}

function InitiativeMenu({ initiative }: { readonly initiative: Initiative }): ReactNode {
  const [open, setOpen] = useState(false);
  const copyLink = useCopyRecordLink();
  const showToast = useToast();
  const dropping = useInitiativeChange(initiative, () => dropInitiative(initiative.id));
  const items: MenuItem[] = [
    {
      icon: <Icon name="link" size={14} />,
      label: "Copy link",
      onSelect: () => copyLink({ kind: "initiative", initiativeId: initiative.id }),
    },
  ];
  if (initiative.state === "shaping" || initiative.state === "active") {
    items.push({
      icon: <Icon name="x" size={14} />,
      label: "Drop the Initiative",
      danger: true,
      onSelect: () => {
        // Read now: the state changes under the mutation, as the Initiative's event lands first.
        const words = droppedWords(initiative.state);
        dropping.mutate(undefined, {
          onSuccess: () => showToast(words),
          onError: (error) => showToast(error.message),
        });
      },
    });
  }
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={200}
      trigger={
        <IconButton
          variant="secondary"
          icon={<Icon name="ellipsis" size={14} />}
          label={`More for ${initiative.name}`}
        />
      }
      items={items}
    />
  );
}
