import { Icon, Popover, Tooltip } from "@the-office/ui";
import { useId, type ReactNode } from "react";
import { clockWords, PHASE_WORDS } from "./live-states.ts";
import type { Light } from "./live-view-types.ts";
import { useNoHover } from "./use-reduced-motion.ts";

const PHASE_ICONS: Readonly<Record<Light["phase"], string>> = {
  day: "sun",
  dusk: "sunset",
  night: "moon",
  dawn: "sunrise",
};

/** Where the hours come from, as the chip's tooltip says it (design decision 11). */
function sunWords(light: Light, zone: string | null): string {
  const { sun } = light;
  if (sun === null) {
    return zone === null
      ? "Day light all day: this browser gives no time zone to work the sun out from."
      : `Day light all day: this browser's time zone (${zone}) has no place to work the sun out from.`;
  }
  if (sun.polar !== null || sun.sunrise === null || sun.sunset === null) {
    return `No sunrise or sunset today in ${sun.timeZone}.`;
  }
  return `Sunrise ${clockWords(sun.sunrise)}, sunset ${clockWords(sun.sunset)} in ${sun.timeZone}, worked out from this browser's time zone. At night idle people have gone home.`;
}

/**
 * The time of day at the floor's top left: the phase and the clock, with where the hours come from
 * in its tooltip, or in a popover at a tap on a screen without hover (spec 4.1).
 */
export function TimeChip({
  light,
  zone,
}: {
  readonly light: Light;
  /** The browser's time zone, said when the sun can't be worked out from it. */
  readonly zone: string | null;
}): ReactNode {
  const noHover = useNoHover();
  const wordsId = useId();
  const phase = PHASE_WORDS[light.phase];
  const clock = clockWords(light.minutes);
  const label = `${phase}, ${clock}`;
  const words = sunWords(light, zone);
  const shown = (
    <>
      <Icon name={PHASE_ICONS[light.phase]} size={14} />
      <b>{phase}</b> · {clock}
    </>
  );
  if (noHover) {
    return (
      <div className="live-time">
        <Popover label={label} trigger={shown} triggerClassName="live-time-chip">
          <p className="popover-words">{words}</p>
        </Popover>
      </div>
    );
  }
  return (
    <div className="live-time">
      <Tooltip content={words} side="bottom" focusable>
        <span className="live-time-chip" role="img" aria-label={label} aria-describedby={wordsId}>
          {shown}
        </span>
      </Tooltip>
      <span id={wordsId} hidden>
        {words}
      </span>
    </div>
  );
}
