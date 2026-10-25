import { useMutation } from "@tanstack/react-query";
import type { WrittenSkill } from "@the-office/contracts";
import { Button, Dialog, Field, Tabs } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { uploadSkill, writeSkill } from "../../../api/skills.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SkillFields, SkillFileInput, useSkillSaved } from "./skill-fields.tsx";
import type { SkillDialog } from "./skills-section.tsx";

type AddingBy = "upload" | "write";

const TABS = [
  { value: "upload", label: "Upload" },
  { value: "write", label: "Write one" },
] as const;

const BLANK: WrittenSkill = { name: "", description: "", instructions: "" };

/** "Add a skill": upload one or write it in place; either way it arrives off until reviewed. */
export function AddSkillDialog({
  onClose,
  onOpen,
}: {
  readonly onClose: () => void;
  readonly onOpen: (dialog: SkillDialog) => void;
}): ReactNode {
  const formId = useId();
  const [by, setBy] = useState<AddingBy>("upload");
  const [file, setFile] = useState<File>();
  const [written, setWritten] = useState(BLANK);
  const saved = useSkillSaved();
  const showToast = useToast();
  const uploading = useMutation({
    mutationFn: uploadSkill,
    onSuccess: async (skill) => {
      await saved(skill);
      showToast(`${skill.name} uploaded. It is off until you review it.`);
      onClose();
    },
  });
  const writing = useMutation({
    mutationFn: writeSkill,
    onSuccess: async (skill) => {
      await saved(skill);
      onOpen({ kind: "review", name: skill.name });
    },
  });
  const failure = by === "upload" ? uploading.error : writing.error;
  return (
    <Dialog
      title="Add a skill"
      width={620}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            loading={uploading.isPending || writing.isPending}
            disabled={by === "upload" && file === undefined}
          >
            {by === "upload" ? "Upload" : "Add to the library"}
          </Button>
        </>
      }
    >
      <div className="skill-tabs">
        <Tabs
          tabs={[...TABS]}
          value={by}
          onChange={(tab) => setBy(tab === "write" ? "write" : "upload")}
        />
      </div>
      <form
        id={formId}
        className="skill-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (by === "write") writing.mutate(written);
          else if (file) uploading.mutate(file);
        }}
      >
        {failure && <RefusalAlert title="The skill can't be added" error={failure} />}
        {by === "upload" ? (
          <Field
            label="A single .md file or a zipped folder"
            hint="It arrives off until you have read its files."
          >
            <SkillFileInput onChange={setFile} />
          </Field>
        ) : (
          <SkillFields skill={written} onChange={setWritten} withName />
        )}
      </form>
    </Dialog>
  );
}
