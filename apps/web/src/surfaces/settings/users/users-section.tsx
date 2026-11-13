import { useQuery } from "@tanstack/react-query";
import type { User } from "@the-office/contracts";
import { Badge, Button, Card, DataTable, Icon, type DataTableColumn } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { userQueries } from "../../../api/users.ts";
import { usePageHeading } from "../../../shell/page-heading.tsx";
import { momentWords } from "../../../shell/time.ts";
import { useClock } from "../../../shell/use-clock.ts";
import { SettingsProblem } from "../settings-card-parts.tsx";
import { AddUserDialog } from "./add-user-dialog.tsx";
import { NewOneTimePasswordDialog } from "./new-one-time-password-dialog.tsx";
import { RemoveUserDialog } from "./remove-user-dialog.tsx";
import { standingOf } from "./users-words.ts";

type OpenDialog =
  | { readonly kind: "add" }
  | { readonly kind: "remove"; readonly user: User }
  | { readonly kind: "new-one-time-password"; readonly user: User };

/**
 * Settings › Users (spec §2.10): The Office's users, you marked; any user adds one, with a one-time
 * password shown once, makes a waiting user a new one, or removes one but themselves.
 */
export function UsersSection(): ReactNode {
  usePageHeading({ title: "Settings", crumb: "Users" });
  const users = useQuery(userQueries.list());
  const [open, setOpen] = useState<OpenDialog>();
  const now = useClock();
  const listed = users.data ?? [];
  const close = (): void => setOpen(undefined);
  return (
    <>
      <Card
        padding="none"
        title={
          <span className="settings-block-title">
            <Icon name="users" size={15} strokeWidth={1.6} />
            Users <span className="settings-count">{listed.length}</span>
          </span>
        }
        subtitle="Everyone who signs in to The Office. Each has their own account; everything else is shared."
        actions={
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Icon name="user-plus" size={14} />}
            onClick={() => setOpen({ kind: "add" })}
          >
            Add a user
          </Button>
        }
      >
        <SettingsProblem title="The users can't be read" error={users.error} />
        <DataTable
          rows={listed}
          columns={columns(now, (user, kind) => setOpen({ kind, user }))}
          loading={users.isPending}
          empty="No users."
        />
      </Card>
      {open?.kind === "add" && <AddUserDialog onClose={close} />}
      {open?.kind === "remove" && <RemoveUserDialog user={open.user} onClose={close} />}
      {open?.kind === "new-one-time-password" && (
        <NewOneTimePasswordDialog user={open.user} onClose={close} />
      )}
    </>
  );
}

function columns(
  now: Date,
  openFor: (user: User, kind: "remove" | "new-one-time-password") => void,
): DataTableColumn<User>[] {
  return [
    {
      key: "name",
      header: "Name",
      wrap: true,
      render: (user) => (
        <span className="users-name">
          {user.name}
          {user.you && (
            <Badge tone="accent" size="sm">
              You
            </Badge>
          )}
        </span>
      ),
    },
    { key: "email", header: "Email", muted: true, wrap: true, render: (user) => user.email },
    {
      key: "standing",
      header: "",
      render: (user) => {
        const standing = standingOf(user, now);
        return (
          standing && (
            <Badge tone={standing.tone} size="sm">
              {standing.words}
            </Badge>
          )
        );
      },
    },
    {
      key: "createdAt",
      header: "Added",
      muted: true,
      render: (user) => momentWords(user.createdAt, now),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (user) => (
        <span className="users-actions">
          {user.oneTimePasswordExpiresAt !== null && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openFor(user, "new-one-time-password")}
            >
              New one-time password
            </Button>
          )}
          <Button
            variant="danger-ghost"
            size="sm"
            aria-label={`Remove ${user.name}`}
            disabled={user.you}
            title={user.you ? "You can't remove yourself." : undefined}
            onClick={() => openFor(user, "remove")}
          >
            Remove
          </Button>
        </span>
      ),
    },
  ];
}
