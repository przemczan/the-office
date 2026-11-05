import { useMutation } from "@tanstack/react-query";
import type { OfficeSshKey } from "@the-office/contracts";
import { Button, Checkbox, Dialog } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { regenerateSshKey } from "../../../api/office-identity.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";

/**
 * Regenerating the Office ssh key (spec §5.5 Defaults): what the user loses is stated, and
 * acknowledged, before the current key is replaced.
 */
export function RegenerateSshKeyDialog({
  onRegenerated,
  onClose,
}: {
  readonly onRegenerated: (sshKey: OfficeSshKey) => void;
  readonly onClose: () => void;
}): ReactNode {
  const [understood, setUnderstood] = useState(false);
  const regenerating = useMutation({
    mutationFn: regenerateSshKey,
    onSuccess: (sshKey) => {
      onRegenerated(sshKey);
      onClose();
    },
  });
  return (
    <Dialog
      size="small"
      title="Regenerate the Office ssh key?"
      onClose={onClose}
      actions={
        <Button
          variant="danger"
          loading={regenerating.isPending}
          disabled={!understood}
          onClick={() => regenerating.mutate()}
        >
          Regenerate the key
        </Button>
      }
    >
      <div className="office-identity-card-body">
        {regenerating.error && (
          <RefusalAlert title="The key wasn't regenerated" error={regenerating.error} />
        )}
        <ul className="regenerate-ssh-key-consequences">
          <li>The current key is deleted for good and can't be brought back.</li>
          <li>
            Every host holding its public half stops letting The Office in until the new public half
            is added there: Projects with ssh remotes can't fetch, push or publish, and Tasks
            reaching them fail at their git steps.
          </li>
          <li>
            Remove the old public half from those hosts: on GitHub, under your account's Settings ›
            SSH and GPG keys.
          </li>
          <li>Sign in with GitHub, https remotes and the Trusted hosts are not affected.</li>
        </ul>
        <Checkbox
          label="I understand The Office loses access to every ssh host until I add the new key"
          checked={understood}
          onChange={setUnderstood}
        />
      </div>
    </Dialog>
  );
}
