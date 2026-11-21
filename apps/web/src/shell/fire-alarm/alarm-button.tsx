import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { FireAlarmWay } from "@the-office/contracts";
import { Button, Icon, Menu, type MenuItem } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { ApiError } from "../../api/api-client.ts";
import { nowQueries } from "../../api/notifications.ts";
import { soundTheAlarm } from "../../api/work.ts";
import { useNotices, useToast } from "../toasts.tsx";
import { useFireAlarmReview } from "./fire-alarm-review.tsx";
import {
  FIRE_ALARM_WAYS,
  soundedWords,
  soundRefusedWords,
  stricterWays,
  type FireAlarmWayWords,
} from "./fire-alarm-words.ts";
import "./fire-alarm.css";

/** Wide enough for the longest hint on one line, as a menu item has the height of two. */
const MENU_WIDTH = 400;

/**
 * The top bar's fire alarm (spec §2.8): "Sound the alarm" opens the three ways to stop, none
 * needing a confirmation; while it is on, "All clear…" opens on Now what would resume, before the
 * user gives it, beside the stricter ways while a softer one is on.
 */
export function AlarmButton(): ReactNode {
  const alarm = useQuery(nowQueries.now()).data?.fireAlarm ?? null;
  const review = useFireAlarmReview();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const notices = useNotices();
  const [open, setOpen] = useState(false);
  // Whether it was on is kept with each sounding: the alarm's own event may come before its answer.
  const sounding = useMutation({
    mutationFn: ({ way }: { readonly way: FireAlarmWay; readonly stricter: boolean }) =>
      soundTheAlarm(way),
    onSuccess: async (_, { way, stricter }) => {
      toast(soundedWords(way, stricter));
      await queryClient.invalidateQueries(nowQueries.now());
    },
    onError: (error, { stricter }) =>
      notices.show({
        key: "fire-alarm-refused",
        title: soundRefusedWords(stricter),
        description: error instanceof ApiError ? error.reasons.join(" ") : error.message,
      }),
  });
  const itemsOf = (ways: readonly FireAlarmWayWords[]): MenuItem[] =>
    ways.map(({ way, label, hint }) => ({
      label: (
        <span className="alarm-way">
          {label}
          <span className="alarm-way-hint">{hint}</span>
        </span>
      ),
      onSelect: () => sounding.mutate({ way, stricter: alarm !== null }),
    }));

  if (alarm === null) {
    return (
      <Menu
        open={open}
        onOpenChange={setOpen}
        align="end"
        width={MENU_WIDTH}
        items={itemsOf(FIRE_ALARM_WAYS)}
        trigger={
          <Button
            variant="danger-ghost"
            iconLeft={<Icon name="siren" size={14} />}
            title="Fire alarm: pause automated work"
            aria-label="Sound the alarm"
            aria-haspopup="menu"
            aria-expanded={open}
            loading={sounding.isPending}
          >
            <span className="shell-top-words">Sound the alarm</span>
          </Button>
        }
      />
    );
  }
  const ways = stricterWays(alarm.way);
  const allClear = (
    <Button
      variant="danger"
      iconLeft={<Icon name="siren" size={14} />}
      title="See what will resume, then give the all clear"
      aria-label="All clear…"
      loading={sounding.isPending}
      onClick={() => {
        review.open();
        void navigate({ to: "/" });
      }}
      style={ways.length > 0 ? JOINED_START : undefined}
    >
      <span className="shell-top-words">All clear…</span>
    </Button>
  );
  if (ways.length === 0) return allClear;
  // The design system's split button names its halves by their words only, which the top bar
  // hides on a narrow page; hence its two halves here, as it joins them.
  return (
    <div role="group" className="split-button">
      {allClear}
      <Menu
        open={open}
        onOpenChange={setOpen}
        align="end"
        width={MENU_WIDTH}
        style={{ position: "static" }}
        items={itemsOf(ways)}
        trigger={
          <Button
            variant="danger"
            disabled={sounding.isPending}
            aria-label="Make the alarm stricter"
            title="Make the alarm stricter"
            aria-haspopup="menu"
            aria-expanded={open}
            style={JOINED_END}
          >
            <Icon name="chevron-down" size={14} />
          </Button>
        }
      />
    </div>
  );
}

const JOINED_START = { borderStartEndRadius: 0, borderEndEndRadius: 0 } as const;
const JOINED_END = {
  padding: "0 var(--space-2)",
  borderStartStartRadius: 0,
  borderEndStartRadius: 0,
} as const;
