import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Channel, NotificationRouting } from "@the-office/contracts";
import { Button, Card, Icon } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import {
  notificationQueries,
  resetRouting,
  setRoutingChannel,
} from "../../../api/notifications.ts";
import { desktopPermission } from "../../../shell/notifications/desktop-channel.ts";
import { SettingsCardTitle, SettingsProblem } from "../settings-card-parts.tsx";
import {
  cellTitle,
  columnNote,
  isSetHere,
  ROUTING_COLUMNS,
  ROUTING_GROUPS,
  type RoutingGroup,
  type RoutingRow,
} from "./routing-words.ts";

interface CellChange {
  readonly level: string;
  readonly channel: Channel;
  readonly on: boolean;
}

/**
 * "What goes where": the kinds tree × the channels (prototypes/app/settings.js
 * `notificationsSection`). A click sets a cell on its row; a kind's row inherits from its group
 * until set, and Reset gives it back.
 */
export function RoutingCard(): ReactNode {
  const queryClient = useQueryClient();
  const routing = useQuery(notificationQueries.routing());
  const [desktop] = useState(desktopPermission);
  const keep = (saved: NotificationRouting): void => {
    queryClient.setQueryData(notificationQueries.routing().queryKey, saved);
  };
  const setting = useMutation({
    mutationFn: ({ level, channel, on }: CellChange) => setRoutingChannel(level, { channel, on }),
    onSuccess: keep,
  });
  const resetting = useMutation({ mutationFn: resetRouting, onSuccess: keep });
  const saving = setting.isPending || resetting.isPending;

  return (
    <Card title={<SettingsCardTitle icon="bell">What goes where</SettingsCardTitle>}>
      <p className="settings-note routing-intro">
        A row inherits from its group until you set it. Splitting a kind later keeps every setting.
        The Project filter never silences anything.
      </p>
      {routing.data && (
        <table className="routing-grid">
          <thead>
            <tr>
              <th />
              {ROUTING_COLUMNS.map(({ channel, label }) => (
                <th key={channel} scope="col">
                  <div>{label}</div>
                  <div className="settings-note">{columnNote(channel, desktop)}</div>
                </th>
              ))}
            </tr>
          </thead>
          {ROUTING_GROUPS.map((group) => (
            <GroupRows
              key={group.level}
              group={group}
              routing={routing.data}
              disabled={saving}
              onSet={(change) => setting.mutate(change)}
              onReset={(level) => resetting.mutate(level)}
            />
          ))}
        </table>
      )}
      <p className="settings-note routing-legend">
        <span className="routing-cell set on" aria-hidden>
          <Icon name="check" size={11} />
        </span>
        set on this row
        <span className="routing-cell on" aria-hidden>
          <Icon name="check" size={11} />
        </span>
        inherited from the group
        <span className="routing-cell" aria-hidden />
        off
      </p>
      <p className="settings-note">
        Never notified: Stage progress, Tasks starting, consultations you&apos;re not in, Agents
        talking to each other.
      </p>
      <SettingsProblem title="What goes where can't be read" error={routing.error} />
      <SettingsProblem title="The change can't be saved" error={setting.error ?? resetting.error} />
    </Card>
  );
}

interface RowsProps {
  readonly routing: NotificationRouting;
  readonly disabled: boolean;
  readonly onSet: (change: CellChange) => void;
}

function GroupRows({
  group,
  onReset,
  ...rows
}: RowsProps & {
  readonly group: RoutingGroup;
  readonly onReset: (level: string) => void;
}): ReactNode {
  return (
    <tbody>
      <tr className="routing-group">
        <th scope="row">{group.label}</th>
        <Cells row={group} {...rows} />
      </tr>
      {group.kinds.map((kind) => (
        <tr key={kind.level}>
          <th scope="row" className="routing-kind">
            {kind.label}
            {kind.hint && <span className="settings-note">{kind.hint}</span>}
            {setsAnything(kind.level, rows.routing) && (
              <Button
                variant="secondary"
                size="sm"
                disabled={rows.disabled}
                title={`Inherit everything from ${group.label} again`}
                onClick={() => onReset(kind.level)}
              >
                Reset
              </Button>
            )}
          </th>
          <Cells row={kind} {...rows} />
        </tr>
      ))}
    </tbody>
  );
}

function Cells({
  row,
  routing,
  disabled,
  onSet,
}: RowsProps & { readonly row: RoutingRow }): ReactNode {
  return ROUTING_COLUMNS.map(({ channel, label }) => {
    const routed = routing[row.level]?.[channel];
    if (!routed) return <td key={channel} />;
    const setHere = isSetHere(row.level, routed);
    return (
      <td key={channel} className="routing-column">
        <button
          type="button"
          className={["routing-cell", routed.on && "on", setHere && "set"]
            .filter(Boolean)
            .join(" ")}
          aria-label={`${label} for ${row.label}`}
          aria-pressed={routed.on}
          title={cellTitle(row.level, routed)}
          disabled={disabled}
          onClick={() => onSet({ level: row.level, channel, on: !routed.on })}
        >
          {routed.on && <Icon name="check" size={14} />}
        </button>
      </td>
    );
  });
}

function setsAnything(level: string, routing: NotificationRouting): boolean {
  const channels = routing[level];
  return (
    channels !== undefined && Object.values(channels).some((routed) => isSetHere(level, routed))
  );
}
