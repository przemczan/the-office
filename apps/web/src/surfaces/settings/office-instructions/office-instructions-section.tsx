import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OFFICE_INSTRUCTIONS_MAX_CHARACTERS } from "@the-office/contracts";
import { Button, Card, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { changeOfficeInstructions, officeInstructionsQuery } from "../../../api/conversations.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";

const LIMIT_WORDS = `${OFFICE_INSTRUCTIONS_MAX_CHARACTERS.toLocaleString("en-US")} characters`;

/** Settings › Office instructions: the one text every person's session gets. */
export function OfficeInstructionsSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Office instructions" });
  const saved = useQuery(officeInstructionsQuery());
  return (
    <>
      {saved.data && <OfficeInstructionsForm saved={saved.data.officeInstructions} />}
      <SettingsProblem title="The Office instructions can't be read" error={saved.error} />
    </>
  );
}

/** How far the text runs over the limit, counted as the service counts it: trimmed. */
function limitProblem(trimmed: string): string | undefined {
  const over = trimmed.length - OFFICE_INSTRUCTIONS_MAX_CHARACTERS;
  if (over <= 0) return undefined;
  return `${over.toLocaleString("en-US")} over the limit of ${LIMIT_WORDS}.`;
}

function OfficeInstructionsForm({ saved }: { readonly saved: string }): ReactNode {
  // Only what the user typed is held, so an untouched text follows a change from elsewhere and a
  // change from elsewhere never replaces what is being typed.
  const [edited, setEdited] = useState<string>();
  const text = edited ?? saved;
  const trimmed = text.trim();
  const dirty = trimmed !== saved;
  const problem = limitProblem(trimmed);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const saving = useMutation({
    mutationFn: changeOfficeInstructions,
    onSuccess: (result) => {
      queryClient.setQueryData(officeInstructionsQuery().queryKey, result);
      setEdited(undefined);
      showToast("Office instructions saved. Sessions that start from now on get them.");
    },
  });
  const discard = (): void => {
    setEdited(undefined);
    saving.reset();
  };
  return (
    <Card title={<SettingsCardTitle icon="scroll-text">Office instructions</SettingsCardTitle>}>
      <div className="office-instructions">
        <p className="settings-note">
          General guidelines every person gets with their Role&apos;s instructions. A Role&apos;s
          instructions and a Project&apos;s CLAUDE.md win where they disagree. A change reaches
          sessions that start after it; a session already going keeps what it started with. Left
          empty, they add nothing.
        </p>
        <Textarea
          aria-label="Office instructions"
          // Always given: without a hint or an error the field drops its wrapper, and the text box
          // would be remade, losing the cursor, the moment the text runs over.
          hint={`At most ${LIMIT_WORDS}.`}
          error={problem}
          rows={20}
          value={text}
          // A save clears what was typed, so nothing is typed until its answer comes.
          readOnly={saving.isPending}
          onChange={(event) => setEdited(event.target.value)}
        />
        {saving.error && (
          <RefusalAlert title="The Office instructions weren't saved" error={saving.error} />
        )}
        <div className="settings-actions">
          <span className="settings-actions-state">{dirty ? "Unsaved changes" : "Saved"}</span>
          <Button
            variant="secondary"
            disabled={!dirty}
            title={dirty ? undefined : "No changes to discard"}
            onClick={discard}
          >
            Discard
          </Button>
          <Button
            loading={saving.isPending}
            disabled={!dirty || problem !== undefined}
            title={dirty ? problem : "No changes to save"}
            onClick={() => saving.mutate(text)}
          >
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}
