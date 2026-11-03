import { useMutation, useQuery } from "@tanstack/react-query";
import type { EngineId, EngineRemovalPreview, EngineSettings } from "@the-office/contracts";
import { Alert, Button, Dialog, Select } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { engineRemovalQuery, removeEngine } from "../../../api/engine.ts";
import { roleQueries } from "../../../api/people.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import {
  movedReferenceChange,
  movedReferencePlace,
  suggestedReplacement,
} from "./engine-removal-words.ts";

/**
 * Removing a saved engine (spec §5.4): the replacement that takes over everything naming it, the
 * Office default's engine suggested, and what moves, read from the service before anything is done.
 */
export function RemoveEngineDialog({
  engineId,
  saved,
  unsavedChanges,
  onRemoved,
  onClose,
}: {
  readonly engineId: EngineId;
  readonly saved: EngineSettings;
  /** The page's draft is read again from what is left, so its unsaved changes go. */
  readonly unsavedChanges: boolean;
  readonly onRemoved: (left: EngineSettings) => Promise<void>;
  readonly onClose: () => void;
}): ReactNode {
  const engineName = (id: EngineId): string =>
    saved.engines.find((engine) => engine.id === id)?.name ?? id;
  const name = engineName(engineId);
  const others = saved.engines.filter(({ id }) => id !== engineId);
  const [replacement, setReplacement] = useState<EngineId | null>(() =>
    suggestedReplacement(
      saved.engines.map(({ id }) => id),
      engineId,
      saved.officeDefault,
    ),
  );
  const preview = useQuery(engineRemovalQuery(engineId, replacement));
  const roles = useQuery(roleQueries.list());
  const removing = useMutation({
    mutationFn: () => removeEngine(engineId, replacement),
    onSuccess: async (left) => {
      await onRemoved(left);
      onClose();
    },
  });
  const refused = (preview.data?.problems.length ?? 0) > 0;
  return (
    <Dialog
      title={`Remove ${name}?`}
      tone="danger"
      width={560}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={removing.isPending}
            // Only what the service read for this replacement, and would let through, is confirmed.
            disabled={!preview.data || refused}
            onClick={() => removing.mutate()}
          >
            Remove {name}
          </Button>
        </>
      }
    >
      <div className="engine-removal">
        {removing.error && <RefusalAlert title={`${name} wasn't removed`} error={removing.error} />}
        {replacement === null ? (
          <Alert tone="warning" title="It is the only engine">
            Everything that names it moves to none, and no session starts until an engine is added.
          </Alert>
        ) : (
          <>
            <Select
              label="Replacement"
              hint="Takes over everything that names it, on the same model where it offers it, else on its default model."
              options={others.map(({ id, name: otherName }) => ({ value: id, label: otherName }))}
              value={replacement}
              onChange={setReplacement}
            />
            <p className="dialog-text">
              A session running on {name} finishes there; its Thread starts fresh on its next
              message.
            </p>
          </>
        )}
        {unsavedChanges && (
          <p className="dialog-text">The changes not saved on this page are discarded.</p>
        )}
        {preview.error && (
          <RefusalAlert title="What it moves can't be read" error={preview.error} />
        )}
        {preview.data && (
          <RemovalMoves
            preview={preview.data}
            name={name}
            describePlace={(move) => movedReferencePlace(move, roles.data)}
            describeChange={(move) => movedReferenceChange(move, engineName)}
          />
        )}
      </div>
    </Dialog>
  );
}

function RemovalMoves({
  preview,
  name,
  describePlace,
  describeChange,
}: {
  readonly preview: EngineRemovalPreview;
  readonly name: string;
  readonly describePlace: (move: EngineRemovalPreview["moves"][number]) => string;
  readonly describeChange: (move: EngineRemovalPreview["moves"][number]) => string;
}): ReactNode {
  return (
    <>
      {preview.problems.length > 0 && (
        <Alert tone="danger" title={`${name} can't be removed with this replacement`}>
          <ul className="refusal-reasons">
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}
      {preview.moves.length === 0 ? (
        <p className="dialog-text">Nothing names {name}.</p>
      ) : (
        <ul className="engine-removal-moves" aria-label="What moves">
          {preview.moves.map((move) => (
            <li key={`${move.roleKey ?? ""}/${move.project?.id ?? ""}`}>
              <span className="engine-removal-place">{describePlace(move)}</span>
              <span>{describeChange(move)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
