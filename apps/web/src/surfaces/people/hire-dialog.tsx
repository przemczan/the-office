import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Preset } from "@the-office/contracts";
import { Button, Dialog, Field, Input, RadioGroup } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { hire, roleQueries } from "../../api/people.ts";
import { personName } from "../../shell/person-name.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { taskLimitShort } from "./role-card-labels.ts";

/** Hiring: a preset, and the person's name; the preset sets the rest of the Role card. */
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
      title="Hire a Role"
      description="One person fills each Role. Every setting can change later on the Role card."
      width={560}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={hiring.isPending}>
            {name.trim() === "" ? "Hire" : `Hire ${name.trim()}`}
          </Button>
        </>
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
        {hiring.error && (
          <RefusalAlert title="The person can't be hired yet" error={hiring.error} />
        )}
        <Field label="Preset">
          <RadioGroup
            value={roleKey}
            options={presets.map(({ roleKey: key, card }) => ({
              value: key,
              label: card.title,
              description: `${card.responsibilities} ${taskLimitShort(card.taskLimit)}.`,
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
