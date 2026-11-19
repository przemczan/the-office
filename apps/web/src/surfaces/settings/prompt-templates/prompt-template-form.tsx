import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  promptTemplateRefusalSchema,
  type PromptTemplate,
  type PromptVariable,
} from "@the-office/contracts";
import { Alert, Badge, Button, Card, Dialog, Icon, Textarea } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { RefusedAs } from "../../../api/api-client.ts";
import {
  promptTemplateQueries,
  resetPromptTemplate,
  savePromptTemplate,
} from "../../../api/prompt-templates.ts";
import { namedTimeWords } from "../../../shell/notifications/notification-words.ts";
import { RefusalAlert } from "../../../shell/refusal-alert.tsx";
import { useToast } from "../../../shell/toasts.tsx";
import { SettingsProblem } from "../settings-card-parts.tsx";
import {
  PROMPT_TEMPLATE_LIMIT_WORDS,
  VARIABLE_KIND_LABELS,
  fieldUsage,
  overLimit,
  problemLine,
  savedLine,
  variableUsage,
} from "./prompt-template-words.ts";

/** The open Prompt template: its text with Save, Discard and Reset to default, and its variables. */
export function PromptTemplateForm({ templateKey }: { readonly templateKey: string }): ReactNode {
  const read = useQuery(promptTemplateQueries.read(templateKey));
  if (!read.data) {
    return <SettingsProblem title="The Prompt template can't be read" error={read.error} />;
  }
  return <TemplateCard template={read.data} />;
}

function TemplateCard({ template }: { readonly template: PromptTemplate }): ReactNode {
  const { key, name, description, customised, problems, variables } = template;
  // Only what the user typed is held, so an untouched text follows a change from elsewhere and a
  // change from elsewhere never replaces what is being typed.
  const [edited, setEdited] = useState<string>();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const text = edited ?? template.text;
  // Compared as it is: whitespace in a prompt is the prompt's own.
  const dirty = text !== template.text;
  const limitProblem = overLimit(text);
  const queryClient = useQueryClient();
  const showToast = useToast();
  const answered = async (result: PromptTemplate): Promise<void> => {
    queryClient.setQueryData(promptTemplateQueries.read(key).queryKey, result);
    setEdited(undefined);
    await queryClient.invalidateQueries({
      queryKey: promptTemplateQueries.list().queryKey,
      exact: true,
    });
  };
  const saving = useMutation({
    mutationFn: (saved: string) => savePromptTemplate(key, saved),
    onSuccess: async (result) => {
      showToast("Prompt template saved");
      await answered(result);
    },
  });
  const resetting = useMutation({
    mutationFn: () => resetPromptTemplate(key),
    onSuccess: async (result) => {
      saving.reset();
      setConfirmingReset(false);
      showToast("Prompt template reset to default");
      await answered(result);
    },
  });
  const discard = (): void => {
    setEdited(undefined);
    saving.reset();
  };
  return (
    <Card
      title={
        <span className="settings-block-title">
          <Icon name="file-text" size={15} strokeWidth={1.6} />
          {name}
          {customised ? (
            <Badge size="sm" tone="accent">
              Customised
            </Badge>
          ) : (
            <Badge size="sm">Default</Badge>
          )}
        </span>
      }
    >
      <div className="prompt-template">
        <p className="settings-note">{description}</p>
        <p className="settings-note">{savedLine(template, namedTimeWords)}</p>
        {problems.length > 0 && (
          <Alert
            tone="warning"
            title="The saved text no longer passes the check, so The Office uses the default until it is fixed."
          >
            <ProblemList lines={problems.map(problemLine)} />
          </Alert>
        )}
        <Textarea
          aria-label={`${name} text`}
          // Always given: without a hint or an error the field drops its wrapper, and the text box
          // would be remade, losing the cursor, the moment the text runs over.
          hint={`At most ${PROMPT_TEMPLATE_LIMIT_WORDS}.`}
          error={limitProblem}
          rows={18}
          spellCheck={false}
          style={{ fontFamily: "var(--font-mono)" }}
          value={text}
          // A save clears what was typed, so nothing is typed until its answer comes.
          readOnly={saving.isPending || resetting.isPending}
          onChange={(event) => setEdited(event.target.value)}
        />
        {saving.error && <SaveRefusal error={saving.error} />}
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
            variant="secondary"
            disabled={!customised}
            title={customised ? undefined : "The default is in use"}
            onClick={() => setConfirmingReset(true)}
          >
            Reset to default
          </Button>
          <Button
            loading={saving.isPending}
            disabled={!dirty || limitProblem !== undefined}
            title={dirty ? limitProblem : "No changes to save"}
            onClick={() => saving.mutate(text)}
          >
            Save
          </Button>
        </div>
        <Variables variables={variables} />
      </div>
      {confirmingReset && (
        <Dialog
          size="small"
          title={`Reset ${name} to default?`}
          onClose={() => {
            setConfirmingReset(false);
            resetting.reset();
          }}
          actions={
            <Button loading={resetting.isPending} onClick={() => resetting.mutate()}>
              Reset to default
            </Button>
          }
        >
          <div className="dialog-stack">
            {resetting.error && (
              <RefusalAlert
                title="The Prompt template wasn't reset to default"
                error={resetting.error}
              />
            )}
            <p className="dialog-text">
              The saved text is replaced by the default that ships with The Office.
              {dirty && " What you typed and haven't saved is lost too."}
            </p>
          </div>
        </Dialog>
      )}
    </Card>
  );
}

/** A refused save: each problem where it is, or the service's reasons. */
function SaveRefusal({ error }: { readonly error: Error }): ReactNode {
  const refusal =
    error instanceof RefusedAs ? promptTemplateRefusalSchema.safeParse(error.refusal) : undefined;
  if (!refusal?.success) {
    return <RefusalAlert title="The Prompt template wasn't saved" error={error} />;
  }
  const { problems, reasons } = refusal.data;
  return (
    <Alert tone="danger" title="The Prompt template wasn't saved">
      <ProblemList lines={problems.length > 0 ? problems.map(problemLine) : reasons} />
    </Alert>
  );
}

function ProblemList({ lines }: { readonly lines: readonly string[] }): ReactNode {
  return (
    <ul className="refusal-reasons">
      {lines.map((line, index) => (
        // Two problems may read alike, so their place in the list tells them apart.
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ul>
  );
}

/** What the template can use, each as it is written, with what it holds. */
function Variables({ variables }: { readonly variables: readonly PromptVariable[] }): ReactNode {
  if (variables.length === 0) {
    return <p className="settings-note">This template uses no variables.</p>;
  }
  return (
    <section className="prompt-template-variables" aria-label="Variables">
      <h4>Variables</h4>
      <ul>
        {variables.map((variable) => (
          <li key={variable.name}>
            <div className="prompt-template-variable-head">
              <code>{variableUsage(variable)}</code>
              <Badge size="sm">{VARIABLE_KIND_LABELS[variable.kind]}</Badge>
            </div>
            <p className="settings-note">{variable.description}</p>
            {variable.fields && variable.fields.length > 0 && (
              <ul className="prompt-template-fields">
                {variable.fields.map((field) => (
                  <li key={field.name}>
                    <code>{fieldUsage(field.name)}</code>
                    <span className="settings-note">{field.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
