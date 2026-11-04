import type { Initiative } from "@the-office/contracts";
import { Button } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { writeInitiativeOutcome } from "../../api/work.ts";
import { MarkdownText } from "../../shell/markdown-text.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { outcomeSummary } from "./initiative-words.ts";
import { PartEditor } from "./part-editor.tsx";
import { RecordFold } from "./record-fold.tsx";
import { useFold } from "./record-folds.ts";
import { useInitiativeChange } from "./use-initiative-change.ts";

/**
 * What must be true once the Initiative is done. The user edits it while it is being shaped;
 * once it is active, it changes only by the CTO's Proposal (spec §2.1 Defaults).
 */
export function OutcomeBlock({ initiative }: { readonly initiative: Initiative }): ReactNode {
  const fold = useFold({ kind: "initiative", id: initiative.id }, "outcome", true);
  const [editing, setEditing] = useState(false);
  const writing = useInitiativeChange(initiative, (outcome: string) =>
    writeInitiativeOutcome(initiative.id, { outcome }),
  );
  return (
    <RecordFold
      fold={fold}
      icon="target"
      title="Outcome"
      summary={outcomeSummary(initiative.outcome)}
      side={
        initiative.state === "shaping" &&
        !editing && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              fold.open();
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )
      }
    >
      {writing.error && <RefusalAlert title="The outcome wasn't saved" error={writing.error} />}
      {editing ? (
        <PartEditor
          label="Outcome"
          hint="What must be true once the Initiative is done, in Markdown."
          initial={initiative.outcome}
          saveLabel="Save"
          saving={writing.isPending}
          onSave={(outcome) => writing.mutate(outcome, { onSuccess: () => setEditing(false) })}
          onCancel={() => setEditing(false)}
        />
      ) : initiative.outcome === "" ? (
        <p className="task-quiet">Not written yet.</p>
      ) : (
        <MarkdownText text={initiative.outcome} />
      )}
    </RecordFold>
  );
}
