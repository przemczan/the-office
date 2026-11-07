import {
  isCustomMarkColour,
  namedMarkColourSchema,
  projectMarkColourSchema,
  type CustomMarkColour,
  type Mark,
} from "@the-office/contracts";
import { Icon, Input, Tooltip } from "@the-office/ui";
import { useId, type CSSProperties, type ReactNode } from "react";
import { ProjectMark } from "../../shell/project-mark.tsx";
import { MARK_COLOUR_LABELS } from "./project-labels.ts";

// Where the user's own colour starts from, so not a token: the picker can't show a variable.
// oxlint-disable-next-line office/restricted-syntax
const FIRST_CUSTOM_COLOUR: CustomMarkColour = "#3366cc";

/**
 * A Project's mark with its label and colour to change. Its tile always shows the letters, as they
 * are what it edits, even when an Icon takes their place everywhere else.
 */
export function MarkPicker({
  projectName,
  mark,
  onChange,
}: {
  readonly projectName: string;
  readonly mark: Mark;
  readonly onChange: (mark: Mark) => void;
}): ReactNode {
  const radioName = useId();
  const custom = isCustomMarkColour(mark.colour);
  return (
    <div className="mark-picker">
      <ProjectMark project={{ name: projectName, mark }} size="xl" />
      <Input
        aria-label="Mark label"
        value={mark.label}
        maxLength={3}
        onChange={(event) => onChange({ ...mark, label: event.target.value })}
        style={{ width: "var(--mark-label-width)" }}
      />
      <div className="mark-swatches" role="radiogroup" aria-label="Colour">
        {namedMarkColourSchema.options.map((colour) => (
          <MarkSwatch
            key={colour}
            radioName={radioName}
            label={MARK_COLOUR_LABELS[colour]}
            className={`mark-colour-${colour}`}
            checked={mark.colour === colour}
            onPick={() => onChange({ ...mark, colour })}
          />
        ))}
        <MarkSwatch
          radioName={radioName}
          label="Custom"
          className="custom"
          style={custom ? ({ "--mark-bg": mark.colour } as CSSProperties) : undefined}
          checked={custom}
          // Choosing Custom again keeps the colour already picked.
          onPick={() => onChange({ ...mark, colour: custom ? mark.colour : FIRST_CUSTOM_COLOUR })}
        >
          {!custom && <Icon name="pipette" size={12} />}
        </MarkSwatch>
      </div>
      {custom && (
        <span className="mark-picker-custom">
          <input
            type="color"
            aria-label="Custom colour"
            value={mark.colour}
            onChange={(event) =>
              onChange({ ...mark, colour: projectMarkColourSchema.parse(event.target.value) })
            }
          />
          <span className="mark-picker-custom-value">{mark.colour}</span>
        </span>
      )}
    </div>
  );
}

/**
 * One colour to pick: a native radio drawn as a round swatch, so the arrow keys move between them,
 * named and shown on hover by the colour's name.
 */
function MarkSwatch({
  radioName,
  label,
  className,
  style,
  checked,
  onPick,
  children,
}: {
  readonly radioName: string;
  readonly label: string;
  /** `custom`, or the colour's `mark-colour-*` class, which fills the swatch as it fills a mark. */
  readonly className: string;
  readonly style?: CSSProperties;
  readonly checked: boolean;
  readonly onPick: () => void;
  /** Drawn over the swatch, such as Custom's icon. */
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <Tooltip content={label}>
      <span className="mark-swatch">
        <input
          type="radio"
          name={radioName}
          className={`mark-swatch-input ${className}`}
          style={style}
          aria-label={label}
          checked={checked}
          onChange={onPick}
        />
        {children && <span className="mark-swatch-over">{children}</span>}
      </span>
    </Tooltip>
  );
}
