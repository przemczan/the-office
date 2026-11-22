import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TIMING_MINUTES_MAX, type NotificationTiming } from "@the-office/contracts";
import { Card } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { notificationQueries, setTiming } from "../../../api/notifications.ts";
import { AccountCardTitle } from "../account-card-title.tsx";
import { NotificationsProblem } from "./notifications-problem.tsx";

/** Quiet hours as the click-through turns them on, for the user to move. */
const QUIET_HOURS_FIRST_SET = { from: "22:00", to: "07:00" } as const;

type Minutes = "holdPhoneMinutes" | "awayMinutes" | "batchOutcomesMinutes";

/**
 * "At the desk" and "Quiet hours and batching" (prototypes/app/settings.js
 * `notificationsSection`): when the signed-in user's Notifications reach their desktop and phone.
 * Each change keeps the whole timing at once.
 */
export function TimingCards(): ReactNode {
  const queryClient = useQueryClient();
  const timing = useQuery(notificationQueries.timing());
  // What the user set, shown at once: the next change builds on it before the service answers.
  const [edited, setEdited] = useState<NotificationTiming | undefined>();
  const saving = useMutation({
    mutationFn: setTiming,
    // One at a time, in the order made, as each sends the whole timing.
    scope: { id: "notification-timing" },
    onSuccess: (saved) => queryClient.setQueryData(notificationQueries.timing().queryKey, saved),
    onError: () => {
      setEdited(undefined);
      void queryClient.invalidateQueries({ queryKey: notificationQueries.timing().queryKey });
    },
  });
  const current = edited ?? timing.data;
  if (!current) {
    return <NotificationsProblem title="The timing can't be read" error={timing.error} />;
  }
  const change = (changed: Partial<NotificationTiming>): void => {
    const next = { ...current, ...changed };
    setEdited(next);
    saving.mutate(next);
  };
  const minutes = (field: Minutes, label: string): ReactNode => (
    <MinutesInput
      key={`${field}-${current[field]}`}
      label={label}
      saved={current[field]}
      onSave={(value) => change({ [field]: value })}
    />
  );
  const { quietHours } = current;

  return (
    <>
      <Card title={<AccountCardTitle icon="monitor">At the desk</AccountCardTitle>}>
        <div className="timing">
          <label>
            Hold phone pushes while you are at the desk: The Office focused or used in the last{" "}
            {minutes("holdPhoneMinutes", "Minutes the phone is held after use")} minutes
          </label>
          <label>
            Send anything still unhandled to your phone{" "}
            {minutes("awayMinutes", "Minutes after you leave")} minutes after you leave
          </label>
          <p className="account-note">
            Desktop notifications show only when the tab isn&apos;t focused; otherwise a toast does.
          </p>
        </div>
      </Card>
      <Card title={<AccountCardTitle icon="moon">Quiet hours and batching</AccountCardTitle>}>
        <div className="timing">
          <div className="timing-quiet">
            <label>
              <input
                type="checkbox"
                checked={quietHours !== null}
                onChange={(event) =>
                  change({ quietHours: event.target.checked ? QUIET_HOURS_FIRST_SET : null })
                }
              />
              Quiet hours
            </label>
            {quietHours && (
              <>
                {" from "}
                <TimeInput
                  label="Quiet hours from"
                  value={quietHours.from}
                  other={quietHours.to}
                  onSave={(from) => change({ quietHours: { ...quietHours, from } })}
                />
                {" to "}
                <TimeInput
                  label="Quiet hours to"
                  value={quietHours.to}
                  other={quietHours.from}
                  onSave={(to) => change({ quietHours: { ...quietHours, to } })}
                />
              </>
            )}
          </div>
          <p className="account-note">
            {quietHours
              ? "Nothing is pushed to you inside the window except “the service or an Agent engine down”; one summary comes when it ends."
              : "Off until you set them."}
          </p>
          <label>
            Collapse Outcomes that land within{" "}
            {minutes("batchOutcomesMinutes", "Minutes Outcomes collapse within")} minutes into one
          </label>
          <p className="account-note">
            Needs you is pushed once per item and never batched. There are no repeat reminders.
          </p>
        </div>
        <NotificationsProblem title="The change can't be saved" error={saving.error} />
      </Card>
    </>
  );
}

/** Minutes kept once the user leaves the field or presses Enter; a number out of range goes back. */
function MinutesInput({
  label,
  saved,
  onSave,
}: {
  readonly label: string;
  readonly saved: number;
  readonly onSave: (minutes: number) => void;
}): ReactNode {
  const [draft, setDraft] = useState(String(saved));
  const keep = (): void => {
    const minutes = Number(draft);
    if (Number.isInteger(minutes) && minutes >= 1 && minutes <= TIMING_MINUTES_MAX) {
      if (minutes !== saved) onSave(minutes);
      return;
    }
    setDraft(String(saved));
  };
  return (
    <input
      type="number"
      className="timing-minutes"
      aria-label={label}
      min={1}
      max={TIMING_MINUTES_MAX}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={keep}
      onKeyDown={(event) => {
        if (event.key === "Enter") keep();
      }}
    />
  );
}

/** A time of day, kept as soon as it is whole and isn't the window's other end. */
function TimeInput({
  label,
  value,
  other,
  onSave,
}: {
  readonly label: string;
  readonly value: string;
  readonly other: string;
  readonly onSave: (time: string) => void;
}): ReactNode {
  return (
    <input
      type="time"
      className="timing-time"
      aria-label={label}
      value={value}
      onChange={(event) => {
        const time = event.target.value;
        if (time && time !== value && time !== other) onSave(time);
      }}
    />
  );
}
