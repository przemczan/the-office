import { Card, Icon } from "@the-office/ui";
import { useId, type ReactNode } from "react";

/** The Role card's groups, in the order the card and its form show them. */
export const ROLE_CARD_GROUPS = {
  identity: { title: "Identity", description: "Who the person is, as People shows them." },
  work: { title: "Work", description: "What the Agent works from, and how much at once." },
  engine: {
    title: "Engine",
    description:
      "How the person works on each engine type. Where they run is set by the Office, the Project, the Initiative or the Task.",
  },
  capabilities: {
    title: "Capabilities",
    description: "Enforced by The Office; combine them freely.",
  },
  permissions: {
    title: "Permissions",
    description: "What the Agent may do in a Stage.",
  },
  authority: {
    title: "Authority",
    description: "What the person may do with Office tools, and when.",
  },
  skills: {
    title: "Skills",
    description: "From the library in Settings; skills for everyone come with every Role.",
  },
  mcpServers: {
    title: "MCP servers",
    description:
      "From the library in Settings. Each tool has its own authority setting; a Stage may narrow it.",
  },
} as const;

/**
 * One group of the Role card: what it covers on the left, its fields on the right
 * (design-system/readme.md, Settings: label-left/controls-right rows).
 */
export function RoleCardGroup({
  group,
  children,
}: {
  readonly group: keyof typeof ROLE_CARD_GROUPS;
  readonly children: ReactNode;
}): ReactNode {
  const headingId = useId();
  const { title, description } = ROLE_CARD_GROUPS[group];
  return (
    <section className="role-card-group" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className="role-card-group-title">
          {title}
        </h3>
        <p className="role-card-group-description">{description}</p>
      </div>
      <div className="role-card-group-fields">{children}</div>
    </section>
  );
}

/** A field as the card shows it: its label over its value. */
export function RoleCardValue({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="role-card-value">
      <div className="role-card-value-label">{label}</div>
      <div className="role-card-value-text">{children}</div>
    </div>
  );
}

/** Under what the Caretaker's card fixes: capabilities, permission profile, Authority, Task limit. */
export function FixedForTheCaretaker(): ReactNode {
  return (
    <p className="role-card-fixed">
      <Icon name="lock" size={12} />
      Built in: fixed for the Caretaker.
    </p>
  );
}

/** A block of a person's page: a card with an icon in its title. */
export function PersonBlock({
  icon,
  title,
  actions,
  children,
}: {
  readonly icon: string;
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Card
      title={
        <span className="person-block-title">
          <Icon name={icon} size={15} strokeWidth={1.6} />
          {title}
        </span>
      }
      actions={actions}
    >
      {children}
    </Card>
  );
}
