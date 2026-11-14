import { Link } from "@tanstack/react-router";
import type { Duty, Preset, Role } from "@the-office/contracts";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { useAskInChat } from "../../shell/chat/ask-in-chat.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { dutyLabels } from "../../shell/duty-words.ts";
import { CAPABILITIES, taskLimitShort } from "../../shell/role-card-words.ts";

/** What the Caretaker's set-up Thread opens with, for the user to finish and send. */
const SET_UP_DRAFT = "Help me set up The Office. I work on ";

/**
 * People while nobody is hired (spec §2.2, "Setting up an Office with nobody hired"), in place of the
 * Hire tile: which preset to hire for which duties and capabilities, how a duty nobody holds falls
 * back, and the ways to fill it: hiring, or setting The Office up with the Caretaker in their chat.
 */
export function OfficeSetupHint({
  presets,
  duties,
  caretaker,
  onHire,
  onStartFromScratch,
}: {
  readonly presets: readonly Preset[];
  readonly duties: readonly Duty[];
  readonly caretaker: Role | undefined;
  /** Undefined while every preset's Role is filled, by someone let go. */
  readonly onHire: (() => void) | undefined;
  readonly onStartFromScratch: () => void;
}): ReactNode {
  const caretakerName = caretaker?.card.name ?? "the Caretaker";
  return (
    <section className="person-tile office-setup-hint" aria-labelledby="office-setup-hint-title">
      <div className="person-tile-head">
        <span className="hire-icon">
          <Icon name="sparkles" size={16} />
        </span>
        <div>
          <h2 id="office-setup-hint-title" className="person-tile-name">
            Nobody is hired yet
          </h2>
          <div className="person-tile-title">Each preset brings the duties it suits</div>
        </div>
      </div>
      <ul className="office-setup-presets">
        {presets.map((preset) => (
          <PresetLine key={preset.roleKey} preset={preset} duties={duties} />
        ))}
      </ul>
      <p className="office-setup-fallback">
        While nobody holds a duty, you do it yourself, except Default person to talk to, which goes
        to {caretakerName}, and Implements and Reviews, whose Pipelines can't start. A Role from
        scratch can take any duty in <Link to="/settings/duties">Settings › Duties</Link>.
      </p>
      <div className="hire-tile-actions">
        {onHire && (
          <Button variant="secondary" onClick={onHire}>
            Hire a Role
          </Button>
        )}
        <Button variant="secondary" onClick={onStartFromScratch}>
          Start from scratch
        </Button>
        {caretaker && <SetUpWithTheCaretaker roleKey={caretaker.key} />}
      </div>
    </section>
  );
}

/** A new Thread in the Caretaker's chat with a set-up draft in its composer; nothing is sent. */
function SetUpWithTheCaretaker({ roleKey }: { readonly roleKey: string }): ReactNode {
  const { person, ask, asking, error } = useAskInChat(roleKey);
  if (!person) return null;
  return (
    <>
      <Button
        variant="primary"
        iconLeft={<Icon name="message-circle" size={14} />}
        loading={asking}
        onClick={() => ask(SET_UP_DRAFT)}
      >
        Set up The Office with {person.card.name}
      </Button>
      {error && <RefusalAlert title="No new Thread" error={error} />}
    </>
  );
}

function PresetLine({
  preset: { card, duties: suited },
  duties,
}: {
  readonly preset: Preset;
  readonly duties: readonly Duty[];
}): ReactNode {
  return (
    <li className="office-setup-preset">
      <span className="office-setup-preset-title">{card.title}</span>
      <span className="office-setup-preset-duties">{dutyLabels(suited, duties).join(", ")}</span>
      <span className="office-setup-preset-capabilities">
        {CAPABILITIES.filter(({ key }) => card.capabilities[key]).map(({ key, label, icon }) => (
          <span key={key} className="person-tile-capability" title={label}>
            <Icon name={icon} size={14} />
            <span className="visually-hidden">{label}</span>
          </span>
        ))}
      </span>
      <span className="office-setup-preset-limit">{taskLimitShort(card.taskLimit)}</span>
    </li>
  );
}
