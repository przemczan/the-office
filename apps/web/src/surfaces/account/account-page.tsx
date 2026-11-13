import { useQuery } from "@tanstack/react-query";
import type { SignedInDevice } from "@the-office/contracts";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  DescriptionList,
  Icon,
  type DataTableColumn,
} from "@the-office/ui";
import type { ReactNode } from "react";
import { userQueries } from "../../api/users.ts";
import { momentWords } from "../../shell/time.ts";
import { useSignOut } from "../../shell/use-sign-out.ts";
import { ADDRESS_KIND_WORDS, browserWords } from "./account-words.ts";
import "./account.css";

/**
 * The signed-in user's account (spec §2.10): their name and email, and their signed-in devices,
 * this one marked, each with Sign out. Signing out this one lands on the sign-in page.
 */
export function AccountPage(): ReactNode {
  const account = useQuery(userQueries.account());
  const devices = useQuery(userQueries.signedInDevices());
  const signingOut = useSignOut();
  const listed = devices.data ?? [];
  return (
    <div className="account-page">
      <Card
        title={
          <span className="account-block-title">
            <Icon name="user-round" size={15} strokeWidth={1.6} />
            Your account
          </span>
        }
      >
        {account.data && (
          <DescriptionList
            items={[
              { label: "Name", value: account.data.name },
              { label: "Email", value: account.data.email },
            ]}
          />
        )}
      </Card>
      <Card
        padding="none"
        title={
          <span className="account-block-title">
            <Icon name="monitor-smartphone" size={15} strokeWidth={1.6} />
            Signed-in devices <span className="account-count">{listed.length}</span>
          </span>
        }
        subtitle="Each browser you signed in from, the most recently used first. Sign out one you no longer use or don't know."
      >
        {devices.error && (
          <div className="account-banner">
            <Alert tone="danger" title="The signed-in devices can't be read">
              {devices.error.message}
            </Alert>
          </div>
        )}
        <DataTable
          rows={listed}
          columns={columns((device) =>
            signingOut.mutate({ id: device.id, thisDevice: device.thisDevice }),
          )}
          loading={devices.isPending}
          empty="No signed-in devices."
        />
      </Card>
    </div>
  );
}

function columns(signOut: (device: SignedInDevice) => void): DataTableColumn<SignedInDevice>[] {
  return [
    {
      key: "device",
      header: "Device",
      wrap: true,
      render: (device) => (
        <span className="account-device">
          {browserWords(device.userAgent)}
          {device.thisDevice && (
            <Badge tone="accent" size="sm">
              This device
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "addressKind",
      header: "Address",
      muted: true,
      render: (device) => ADDRESS_KIND_WORDS[device.addressKind],
    },
    {
      key: "signedInAt",
      header: "Signed in",
      muted: true,
      render: (device) => momentWords(device.signedInAt),
    },
    {
      key: "lastSeenAt",
      header: "Last used",
      muted: true,
      render: (device) => momentWords(device.lastSeenAt),
    },
    {
      key: "signOut",
      header: "",
      align: "right",
      render: (device) => (
        <Button
          variant="secondary"
          size="sm"
          aria-label={
            device.thisDevice
              ? "Sign out this device"
              : `Sign out ${browserWords(device.userAgent)}, last used ${momentWords(device.lastSeenAt)}`
          }
          onClick={() => signOut(device)}
        >
          Sign out
        </Button>
      ),
    },
  ];
}
