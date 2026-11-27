import { Button, Icon, IconButton, Input } from "@the-office/ui";
import type { ReactNode } from "react";
import { addDays, isCalendarDay } from "./days-words.ts";

/**
 * Work › Days' picker: ‹ and › step one day, Today and Yesterday, and a date field for any day.
 * Every choice goes to `onPick`, which writes it into the address. Today comes from the service's
 * answer (`today`, undefined until the first one arrives) and never from this browser's clock, so
 * the choices that need it stay off until then.
 */
export function DayPicker({
  day,
  today,
  onPick,
}: {
  /** The day asked for, or what the service answered when none was. */
  readonly day: string | undefined;
  readonly today: string | undefined;
  readonly onPick: (day: string) => void;
}): ReactNode {
  const yesterday = today === undefined ? undefined : addDays(today, -1);
  const lastDay = today !== undefined && day !== undefined && day >= today;
  return (
    <div className="days-picker" role="group" aria-label="Choose a day">
      <IconButton
        size="sm"
        variant="secondary"
        icon={<Icon name="chevron-left" size={14} />}
        label="Previous day"
        disabled={day === undefined}
        onClick={() => day !== undefined && onPick(addDays(day, -1))}
      />
      <IconButton
        size="sm"
        variant="secondary"
        icon={<Icon name="chevron-right" size={14} />}
        label="Next day"
        disabled={day === undefined || today === undefined || lastDay}
        onClick={() => day !== undefined && onPick(addDays(day, 1))}
      />
      <Button
        size="sm"
        variant="secondary"
        disabled={today === undefined}
        onClick={() => today !== undefined && onPick(today)}
      >
        Today
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={yesterday === undefined}
        onClick={() => yesterday !== undefined && onPick(yesterday)}
      >
        Yesterday
      </Button>
      <Input
        type="date"
        aria-label="Day"
        size="sm"
        value={day ?? ""}
        {...(today !== undefined && { max: today })}
        onChange={(event) => {
          const chosen = event.target.value;
          if (isCalendarDay(chosen) && (today === undefined || chosen <= today)) onPick(chosen);
        }}
      />
    </div>
  );
}
