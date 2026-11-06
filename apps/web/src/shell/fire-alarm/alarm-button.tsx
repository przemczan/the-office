import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { nowQueries } from "../../api/notifications.ts";
import { soundTheAlarm } from "../../api/work.ts";
import { useToast } from "../toasts.tsx";
import { useFireAlarmReview } from "./fire-alarm-review.tsx";

/**
 * The top bar's fire alarm (spec §2.8): "Sound the alarm" needs no confirmation; while it is on,
 * "All clear…" opens on Now what would resume, before the user gives it.
 */
export function AlarmButton(): ReactNode {
  const alarm = useQuery(nowQueries.now()).data?.fireAlarm ?? null;
  const review = useFireAlarmReview();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const sounding = useMutation({
    mutationFn: soundTheAlarm,
    onSuccess: async () => {
      toast("Alarm sounded: every Stage stops at its next safe point. Chats stay open.");
      await queryClient.invalidateQueries(nowQueries.now());
    },
  });
  if (alarm) {
    return (
      <Button
        variant="danger"
        iconLeft={<Icon name="siren" size={14} />}
        title="See what will resume, then give the all clear"
        aria-label="All clear…"
        onClick={() => {
          review.open();
          void navigate({ to: "/" });
        }}
      >
        <span className="shell-top-words">All clear…</span>
      </Button>
    );
  }
  return (
    <Button
      variant="danger-ghost"
      iconLeft={<Icon name="siren" size={14} />}
      title="Fire alarm: pause all automated work"
      aria-label="Sound the alarm"
      loading={sounding.isPending}
      onClick={() => sounding.mutate()}
    >
      <span className="shell-top-words">Sound the alarm</span>
    </Button>
  );
}
