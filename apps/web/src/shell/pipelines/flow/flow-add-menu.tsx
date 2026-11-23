import { useQuery } from "@tanstack/react-query";
import type { Stage } from "@the-office/contracts";
import { Button, Icon, Menu, type MenuItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { stageTemplateQueries } from "../../../api/pipelines.ts";
import {
  STAGE_KIND_ICONS,
  STAGE_KIND_NAMES,
  stageFromTemplate,
  standaloneStage,
  type StageKind,
} from "../stage-edits.ts";

const KINDS: readonly StageKind[] = ["agent", "script", "gate"];

/**
 * A menu of a new Stage's kinds (Agent Stage, Script Stage, Gate) and, with `templates`, the Stage
 * templates, each added without its failure rule, linked to its template with `links` (a Pipeline's
 * Stages) or else a copy (a Task's own): the head's Add a Stage, and a route's Insert a Stage on
 * this route.
 */
export function FlowAddMenu({
  label,
  heading,
  templates = false,
  links = false,
  variant = "secondary",
  disabled = false,
  title,
  onAdd,
}: {
  /** The button's words, such as "Add a Stage". */
  readonly label: string;
  /** The menu's heading over the kinds. */
  readonly heading: string;
  readonly templates?: boolean;
  /** A Stage added from a template is linked to it. */
  readonly links?: boolean;
  readonly variant?: "secondary" | "ghost";
  readonly disabled?: boolean;
  /** Why it is disabled, as its tooltip. */
  readonly title?: string | undefined;
  readonly onAdd: (stage: Stage) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const listed = useQuery({ ...stageTemplateQueries.list(), enabled: templates && open });
  const kinds: MenuItem[] = [
    { heading },
    ...KINDS.map((kind) => ({
      label: STAGE_KIND_NAMES[kind],
      icon: <Icon name={STAGE_KIND_ICONS[kind]} size={14} />,
      onSelect: () => onAdd(standaloneStage(kind)),
    })),
  ];
  const fromTemplates: MenuItem[] = !templates
    ? []
    : [
        { divider: true },
        { heading: "From a template" },
        ...((listed.data ?? []).length > 0
          ? (listed.data ?? []).map((template) => ({
              label: template.stage.name,
              icon: <Icon name={STAGE_KIND_ICONS[template.stage.kind]} size={14} />,
              onSelect: () => onAdd(stageFromTemplate(template, links)),
            }))
          : [
              {
                label: listed.error
                  ? "The Stage templates can't be read"
                  : "No Stage template yet. Make one in Settings › Pipelines, or save a Stage as one.",
                disabled: true,
              },
            ]),
      ];
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="start"
      width={260}
      trigger={
        <Button
          size="sm"
          variant={variant}
          disabled={disabled}
          title={title}
          iconLeft={<Icon name="plus" size={12} />}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {label}
        </Button>
      }
      items={[...kinds, ...fromTemplates]}
    />
  );
}
