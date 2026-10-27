import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Role } from "@the-office/contracts";
import { Button, Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { letGoOfPerson, roleQueries } from "../../api/people.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";

/** Letting a person go (spec §2.2), confirmed since it takes them off every Pipeline. */
export function LetGoDialog({
  role,
  onClose,
}: {
  readonly role: Role;
  readonly onClose: () => void;
}): ReactNode {
  const { card } = role;
  const queryClient = useQueryClient();
  const showToast = useToast();
  const letting = useMutation({
    mutationFn: () => letGoOfPerson(role.key),
    onSuccess: async (letGo) => {
      queryClient.setQueryData(roleQueries.one(letGo.key).queryKey, letGo);
      await queryClient.invalidateQueries(roleQueries.list());
      showToast(`${card.name} was let go.`);
      onClose();
    },
  });
  return (
    <Dialog
      title={`Let ${card.name} go?`}
      tone="danger"
      width={480}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={letting.isPending} onClick={() => letting.mutate()}>
            Let {card.name} go
          </Button>
        </>
      }
    >
      {letting.error && (
        <RefusalAlert title={`${card.name} can't be let go`} error={letting.error} />
      )}
      <p className="dialog-text">
        Nobody fills the {card.title} Role from then on. {card.name}'s Role card, Memory and chats
        are kept, unused and readable, and you can hire {card.name} back.
      </p>
      <p className="dialog-text">
        Tasks that still need {card.title} for a Stage are paused, each with a Decision to resume it
        once someone fills the Role, or to drop it.
      </p>
    </Dialog>
  );
}
