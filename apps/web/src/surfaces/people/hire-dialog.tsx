import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Preset } from "@the-office/contracts";
import { Button, Dialog, Field, Input, RadioGroup } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { dutyQueries, hire, roleQueries } from "../../api/people.ts";
import { suitsWords } from "../../shell/duty-words.ts";
import { personName } from "../../shell/person-name.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { taskLimitShort } from "../../shell/role-card-words.ts";

/**
 * Hiring: a preset, and the person's name; the preset sets the rest of the Role card. Each preset
 * says the duties it suits, those its Role holds by default.
 */
export function HireDialog({
  presets,
  onClose,
}: {
  /** The presets whose Role nobody fills yet; at least one. */
  readonly presets: readonly Preset[];
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const [roleKey, setRoleKey] = useState(presets[0]?.roleKey ?? "");
  const preset = presets.find((candidate) => candidate.roleKey === roleKey);
  // The name follows the chosen preset's suggestion until the user writes one of their own.
  const [typedName, setTypedName] = useState<string>();
  const name = typedName ?? preset?.suggestedName ?? "";
  const duties = useQuery(dutyQueries.list());
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const showToast = useToast();
  const hiring = useMutation({
    mutationFn: hire,
    onSuccess: async (role) => {
      queryClient.setQueryData(roleQueries.one(role.key).queryKey, role);
      await queryClient.invalidateQueries(roleQueries.list());
      showToast(`${personName(role)} hired.`);
      onClose();
      await navigate({ to: "/people/$roleKey", params: { roleKey: role.key } });
    },
  });
  return (
    <Dialog
      size="medium"
      title="Hire a Role"
      unsavedChanges={roleKey !== presets[0]?.roleKey || typedName !== undefined}
      onClose={onClose}
      actions={
        <Button type="submit" form={formId} loading={hiring.isPending}>
          {name.trim() === "" ? "Hire" : `Hire ${name.trim()}`}
        </Button>
      }
    >
      <form
        id={formId}
        className="hire-form"
        onSubmit={(event) => {
          event.preventDefault();
          hiring.mutate({ roleKey, name });
        }}
      >
        <p className="dialog-text">
          One person fills each Role. Every setting can change later on the Role card.
        </p>
        {hiring.error && (
          <RefusalAlert title="The person can't be hired yet" error={hiring.error} />
        )}
        <Field label="Preset">
          <RadioGroup
            value={roleKey}
            options={presets.map(({ roleKey: key, card, duties: suited }) => ({
              value: key,
              label: card.title,
              description: [
                card.responsibilities,
                duties.data ? suitsWords(suited, duties.data) : "",
                `${taskLimitShort(card.taskLimit)}.`,
              ]
                .filter((words) => words !== "")
                .join(" "),
            }))}
            onChange={setRoleKey}
          />
        </Field>
        <Input
          label="Name"
          hint="Shown with the title, as in Ada · Developer."
          value={name}
          onChange={(event) => setTypedName(event.target.value)}
          autoFocus
        />
      </form>
    </Dialog>
  );
}
