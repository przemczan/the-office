import { useMutation } from "@tanstack/react-query";
import { Button, Dialog } from "@the-office/ui";
import type { ReactNode } from "react";
import { RefusalAlert } from "../refusal-alert.tsx";
import { useToast } from "../toasts.tsx";

/**
 * Removing a Pipeline asks first, an office-wide one or a Project Pipeline alike; the service
 * refuses while something uses it (a Project's default, a Task that hasn't started on it, an
 * Initiative, or onboarding for Onboard), and the dialog shows every reason.
 */
export function RemovePipelineDialog({
  name,
  remove,
  removedToast,
  onRemoved,
  onClose,
}: {
  readonly name: string;
  readonly remove: () => Promise<void>;
  /** What the toast says once it is gone, such as "Full removed from the library." */
  readonly removedToast: string;
  /** Told once it is removed, after the toast, to refresh and leave its address. */
  readonly onRemoved: () => Promise<void>;
  readonly onClose: () => void;
}): ReactNode {
  const showToast = useToast();
  const removing = useMutation({
    mutationFn: remove,
    onSuccess: async () => {
      showToast(removedToast);
      onClose();
      await onRemoved();
    },
  });
  return (
    <Dialog
      size="small"
      title={`Remove ${name}?`}
      onClose={onClose}
      actions={
        <Button variant="danger" loading={removing.isPending} onClick={() => removing.mutate()}>
          Remove the Pipeline
        </Button>
      }
    >
      <div className="dialog-stack">
        <p className="dialog-text">
          Running and finished Tasks keep the copy of its Stages they started with.
        </p>
        {removing.error && (
          <RefusalAlert title={`${name} can't be removed`} error={removing.error} />
        )}
      </div>
    </Dialog>
  );
}
