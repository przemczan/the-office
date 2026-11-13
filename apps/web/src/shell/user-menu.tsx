import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button, Icon } from "@the-office/ui";
import type { ReactNode } from "react";
import { userQueries } from "../api/users.ts";
import { FloatingMenu } from "./floating-menu.tsx";
import { useSignOut } from "./use-sign-out.ts";

/** The top bar's user menu: the signed-in user's name, opening Account and Sign out. */
export function UserMenu(): ReactNode {
  const account = useQuery(userQueries.account());
  const navigate = useNavigate();
  const signingOut = useSignOut();
  const name = account.data?.name ?? "Account";
  return (
    <FloatingMenu
      align="end"
      width={200}
      trigger={
        <Button
          variant="ghost"
          iconLeft={<Icon name="circle-user-round" size={14} />}
          aria-label={`User menu: ${name}`}
        >
          <span className="shell-top-words user-menu-name">{name}</span>
        </Button>
      }
      items={[
        {
          icon: <Icon name="user-round" size={14} />,
          label: "Account",
          onSelect: () => void navigate({ to: "/account" }),
        },
        {
          icon: <Icon name="log-out" size={14} />,
          label: "Sign out",
          disabled: signingOut.isPending,
          onSelect: () => signingOut.mutate({ thisDevice: true }),
        },
      ]}
    />
  );
}
