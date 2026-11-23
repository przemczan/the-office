import { MAX_WINDOW_START_TIMES, type EngineWindowStart } from "@the-office/contracts";
import { Button, Icon, IconButton, Input, Switch } from "@the-office/ui";
import type { ReactNode } from "react";
import { setTimeProblems, type WindowStartDraft } from "./engine-settings-draft.ts";
import { lastWords, nextStartWords, nextWholeHourIn, timesInWords } from "./window-start-words.ts";

/**
 * An engine with usage windows' Window start on its Settings tab: "Start at set times" with a time
 * field and Remove for each, "Start again after each reset", then its next start and its last start
 * or skip as saved, which the event stream keeps fresh (screens/settings.md "Engines").
 */
export function WindowStartFields({
  windowStart,
  timeZone,
  nextStartAt,
  last,
  change,
}: {
  readonly windowStart: WindowStartDraft;
  /** The service's time zone, which the set times follow. */
  readonly timeZone: string;
  readonly nextStartAt: EngineWindowStart["nextStartAt"];
  readonly last: EngineWindowStart["last"];
  readonly change: (windowStart: WindowStartDraft) => void;
}): ReactNode {
  const { setTimesOn, startAtTimes, startAfterReset } = windowStart;
  const problems = setTimeProblems(startAtTimes);
  const changeTimes = (times: readonly string[]): void =>
    change({ ...windowStart, startAtTimes: times });
  const nextLine = nextStartWords(nextStartAt, timeZone);
  const lastLine = lastWords(last, timeZone);
  return (
    <section className="window-start" aria-label="Window start">
      <h3 className="window-start-title">Window start</h3>
      <Switch
        label="Start at set times"
        checked={setTimesOn}
        onChange={(on) =>
          change({
            ...windowStart,
            setTimesOn: on,
            startAtTimes: on ? [nextWholeHourIn(timeZone)] : [],
          })
        }
      />
      {setTimesOn && (
        <div className="window-start-times">
          {startAtTimes.map((time, index) => (
            // A time's place is its identity: two rows may read the same while one is fixed.
            <div className="window-start-time" key={index}>
              <Input
                type="time"
                aria-label={`Set time ${index + 1}`}
                value={time}
                error={problems[index]}
                onChange={(event) =>
                  changeTimes(
                    startAtTimes.map((kept, at) => (at === index ? event.target.value : kept)),
                  )
                }
              />
              <IconButton
                // Level with the time field beside it.
                size="md"
                icon={<Icon name="x" size={14} />}
                label={`Remove ${time || "the empty time"}`}
                onClick={() => changeTimes(startAtTimes.filter((_kept, at) => at !== index))}
              />
            </div>
          ))}
          <div className="window-start-add">
            <Button
              variant="secondary"
              size="sm"
              disabled={startAtTimes.length >= MAX_WINDOW_START_TIMES}
              onClick={() => changeTimes([...startAtTimes, ""])}
            >
              Add a time
            </Button>
            <span className="window-start-zone">{timesInWords(timeZone)}</span>
          </div>
        </div>
      )}
      <Switch
        label="Start again after each reset"
        checked={startAfterReset}
        onChange={(on) => change({ ...windowStart, startAfterReset: on })}
      />
      {(nextLine || lastLine) && (
        <div className="window-start-status" role="status">
          {nextLine && <span>{nextLine}</span>}
          {lastLine && <span>{lastLine}</span>}
        </div>
      )}
    </section>
  );
}
