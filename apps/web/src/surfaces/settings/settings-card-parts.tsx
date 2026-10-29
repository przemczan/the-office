import { Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";

/** A settings card's title: its icon, then its name. */
export function SettingsCardTitle({
  icon,
  children,
}: {
  readonly icon: string;
  readonly children: string;
}): ReactNode {
  return (
    <span className="settings-block-title">
      <Icon name={icon} size={15} strokeWidth={1.6} />
      {children}
    </span>
  );
}

/** What went wrong reading or saving a setting, in the card it belongs to. */
export function SettingsProblem({
  title,
  error,
}: {
  readonly title: string;
  readonly error: Error | null;
}): ReactNode {
  return (
    error && (
      <div className="settings-banner">
        <RefusalAlert title={title} error={error} />
      </div>
    )
  );
}
