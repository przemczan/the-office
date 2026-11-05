import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Field } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { uploadSkillVersion } from "../../../api/skills.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SkillFileInput, useSkillSaved } from "./skill-fields.tsx";
import type { SkillDialog } from "./skills-section.tsx";

/** Upload a new version of an uploaded skill; it waits for review like the first. */
export function UploadVersionDialog({
  name,
  onClose,
  onOpen,
}: {
  readonly name: string;
  readonly onClose: () => void;
  readonly onOpen: (dialog: SkillDialog) => void;
}): ReactNode {
  const formId = useId();
  const [file, setFile] = useState<File>();
  const saved = useSkillSaved();
  const showToast = useToast();
  const uploading = useMutation({
    mutationFn: (chosen: File) => uploadSkillVersion(name, chosen),
    onSuccess: async (skill) => {
      await saved(skill);
      showToast(`${skill.name} saved as version ${skill.version}. It waits for your review.`);
      onOpen({ kind: "review", name: skill.name });
    },
  });
  return (
    <Dialog
      size="medium"
      title={`Upload a new version of ${name}`}
      onClose={onClose}
      actions={
        <Button type="submit" form={formId} loading={uploading.isPending} disabled={!file}>
          Upload
        </Button>
      }
    >
      <form
        id={formId}
        className="skill-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (file) uploading.mutate(file);
        }}
      >
        <p className="dialog-text">
          Its SKILL.md names the same skill. Running sessions keep the version they started with.
        </p>
        {uploading.error && (
          <RefusalAlert title="The new version can't be saved" error={uploading.error} />
        )}
        <Field
          label="A single .md file or a zipped folder"
          hint="It arrives off until you have read its files."
        >
          <SkillFileInput onChange={setFile} />
        </Field>
      </form>
    </Dialog>
  );
}
