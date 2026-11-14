import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { WrittenSkill } from "@the-office/contracts";
import { Alert, Button, Dialog, Field, Input, Tabs } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { uploadSkill, writeSkill } from "../../../api/skills.ts";
import { useAskDevops } from "../../../shell/ask-devops.tsx";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SkillFields, SkillFileInput, useSkillSaved } from "./skill-fields.tsx";
import type { SkillDialog } from "./skills-section.tsx";

type AddingBy = (typeof TABS)[number]["value"];

const TABS = [
  { value: "install", label: "Install from a source" },
  { value: "upload", label: "Upload" },
  { value: "write", label: "Write one" },
] as const;

const BLANK: WrittenSkill = { name: "", description: "", instructions: "" };

/**
 * "Add a skill": ask whoever onboards Projects to install it from a source, upload one or write it in place; however
 * it comes, it arrives off until reviewed (spec §2.6).
 */
export function AddSkillDialog({
  onClose,
  onOpen,
}: {
  readonly onClose: () => void;
  readonly onOpen: (dialog: SkillDialog) => void;
}): ReactNode {
  const formId = useId();
  const [by, setBy] = useState<AddingBy>("install");
  const [source, setSource] = useState("");
  const [file, setFile] = useState<File>();
  const [written, setWritten] = useState(BLANK);
  const saved = useSkillSaved();
  const showToast = useToast();
  const devops = useAskDevops(onClose);
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
  const failure = { install: devops.error, upload: uploading.error, write: writing.error }[by];
  return (
    <Dialog
      size="medium"
      title="Add a skill"
      onClose={onClose}
      actions={
        (by !== "install" || devops.person) && (
          <Button
            type="submit"
            form={formId}
            loading={devops.asking || uploading.isPending || writing.isPending}
            disabled={
              (by === "install" && source.trim() === "") || (by === "upload" && file === undefined)
            }
          >
            {by === "install"
              ? `Ask ${devops.person?.card.name ?? ""} to install it`
              : by === "upload"
                ? "Upload"
                : "Add to the library"}
          </Button>
        )
      }
    >
      <div className="skill-tabs">
        <Tabs
          tabs={[...TABS]}
          value={by}
          onChange={(tab) => setBy(TABS.find(({ value }) => value === tab)?.value ?? "install")}
        />
      </div>
      <form
        id={formId}
        className="skill-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (by === "install") devops.ask(installDraft(source.trim()));
          else if (by === "write") writing.mutate(written);
          else if (file) uploading.mutate(file);
        }}
      >
        {failure && <RefusalAlert title="The skill can't be added" error={failure} />}
        {by === "install" &&
          (devops.person ? (
            <Input
              label="Source"
              hint={`Installing counts as an install: ${devops.person.card.name} · ${devops.person.card.title} fetches it into the library at a pinned version and you confirm. It arrives off until you have read its files.`}
              placeholder="owner/repo or a URL"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              autoFocus
            />
          ) : (
            <Alert tone="info" title="Installing needs whoever holds Onboards and repairs Projects">
              They fetch a skill from its source at a pinned version, and you confirm it. Choose who
              in Settings › Duties, or <Link to="/people">hire someone on the People page.</Link>
            </Alert>
          ))}
        {by === "upload" && (
          <Field
            label="A single .md file or a zipped folder"
            hint="It arrives off until you have read its files."
          >
            <SkillFileInput onChange={setFile} />
          </Field>
        )}
        {by === "write" && (
          <>
            <SkillFields skill={written} onChange={setWritten} withName />
            <p className="dialog-hint">Or ask someone to draft it as a Proposal from their chat.</p>
          </>
        )}
      </form>
    </Dialog>
  );
}

/** What waits in Devops' composer: the source, for the user to send or add to. */
function installDraft(source: string): string {
  return `Can you install the skills from ${source}?`;
}
