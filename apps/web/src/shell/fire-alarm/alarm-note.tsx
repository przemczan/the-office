import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { fireAlarmLiftsQuery, liftTheAlarm, takeTheLiftBack } from "../../api/conversations.ts";
import { nowQueries } from "../../api/notifications.ts";
import { RefusalAlert } from "../refusal-alert.tsx";
import { alarmHoldsChats } from "./fire-alarm-words.ts";
import "./fire-alarm.css";

/**
 * Under a chat's composer while the fire alarm is on ASAP (spec §2.8): the person answers but runs
 * no tools, unless the user lets them act in this Thread, until the all clear or until they take it
 * back. Under a softer way chats keep their tools, and there is nothing to lift.
 */
export function AlarmNote({
  threadId,
  personName,
}: {
  readonly threadId: string;
  readonly personName: string;
}): ReactNode {
  const holdsChats = alarmHoldsChats(useQuery(nowQueries.now()).data?.fireAlarm);
  const lifts = useQuery({ ...fireAlarmLiftsQuery(), enabled: holdsChats });
  const queryClient = useQueryClient();
  const changing = useMutation({
    mutationFn: (lifted: boolean) => (lifted ? liftTheAlarm(threadId) : takeTheLiftBack(threadId)),
    onSuccess: (now) => queryClient.setQueryData(fireAlarmLiftsQuery().queryKey, now),
  });
  if (!holdsChats || !lifts.data) return null;
  const lifted = lifts.data.threadIds.includes(threadId);
  return (
    <>
      {changing.error && <RefusalAlert title="That didn't change" error={changing.error} />}
      <p className={`composer-note alarm-note${lifted ? " lifted" : ""}`} role="note">
        <Icon name={lifted ? "wrench" : "siren"} size={14} />
        <span className="composer-note-text">
          {lifted
            ? `${personName} may run tools in this thread while the alarm is on.`
            : `Alarm on: ${personName} answers but runs no tools.`}
        </span>
        <Button
          size="sm"
          variant="secondary"
          loading={changing.isPending}
          onClick={() => changing.mutate(!lifted)}
        >
          {lifted ? "Take it back" : `Let ${personName} act in this thread`}
        </Button>
      </p>
    </>
  );
}
