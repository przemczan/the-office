import { useQuery } from "@tanstack/react-query";
import type { Stage } from "@the-office/contracts";
import { Button, Icon, Menu, type MenuItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { stageTemplateQueries } from "../../../api/pipelines.ts";
import {
  differenceWords,
  fieldsDiffering,
  templateFieldLabel,
  unlinkedStage,
  withTemplateFields,
} from "../template-link.ts";

/**
 * Over a linked Stage's form (docs/spec/screens/pipeline-flow-editor.md, "Linked-template line"):
 * its template and how the Stage differs from it, Take the template's while it differs, and Unlink.
 * A link to a template since removed shows nothing: the Pipeline's save drops it.
 */
export function FlowTemplateLine({
  stage,
  disabled,
  onChange,
}: {
  readonly stage: Stage;
  /** A locked Stage's line reads only. */
  readonly disabled: boolean;
  readonly onChange: (stage: Stage) => void;
}): ReactNode {
  const listed = useQuery({
    ...stageTemplateQueries.list(),
    enabled: stage.templateId !== undefined,
  });
  const template = listed.data?.find(({ id }) => id === stage.templateId);
  if (!template) return null;
  const differing = fieldsDiffering(stage, template.stage);
  return (
    <div className="flow-template-line">
      <p className="flow-panel-hint flow-template-line-words">
        <Icon name="link" size={12} />
        <span>
          Linked to the template <strong>{template.stage.name}</strong> ·{" "}
          {differenceWords(differing)}
        </span>
      </p>
      <span className="flow-panel-tools">
        {differing.length > 0 && (
          <TakeMenu
            differing={differing}
            disabled={disabled}
            onTake={(fields) => onChange(withTemplateFields(stage, template.stage, fields))}
          />
        )}
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Icon name="unlink" size={12} />}
          disabled={disabled}
          onClick={() => onChange(unlinkedStage(stage))}
        >
          Unlink
        </Button>
      </span>
    </div>
  );
}

/** Take the template's: each field the Stage differs in, then All its fields. */
function TakeMenu({
  differing,
  disabled,
  onTake,
}: {
  readonly differing: readonly string[];
  readonly disabled: boolean;
  readonly onTake: (fields: readonly string[]) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const items: MenuItem[] = [
    ...differing.map((field) => ({
      label: templateFieldLabel(field),
      onSelect: () => onTake([field]),
    })),
    { divider: true },
    { label: "All its fields", onSelect: () => onTake(differing) },
  ];
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={220}
      trigger={
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Icon name="rotate-ccw" size={12} />}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          Take the template's
        </Button>
      }
      items={items}
    />
  );
}
