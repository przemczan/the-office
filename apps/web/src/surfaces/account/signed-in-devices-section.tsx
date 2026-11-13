import { useQuery } from "@tanstack/react-query";
import type { SignedInDevice } from "@the-office/contracts";
import { Alert, Badge, Button, Card, DataTable, type DataTableColumn } from "@the-office/ui";
import type { ReactNode } from "react";
import { userQueries } from "../../api/users.ts";
import { usePageHeading } from "../../shell/page-heading.tsx";
import { momentWords } from "../../shell/time.ts";
import { useSignOut } from "../../shell/use-sign-out.ts";
import { AccountCardTitle } from "./account-card-title.tsx";
import { ADDRESS_KIND_WORDS, browserWords } from "./account-words.ts";

/**
 * Account › Signed-in devices (spec §2.10): each browser the user signed in from, this one marked,
 * each with Sign out. Signing out this one lands on the sign-in page.
 */
export function SignedInDevicesSection(): ReactNode {
  usePageHeading({ title: "Account", crumb: "Signed-in devices" });
  const devices = useQuery(userQueries.signedInDevices());
  const signingOut = useSignOut();
  const listed = devices.data ?? [];
  return (
    <div className="account-cards">
      <Card
        padding="none"
        title={
          <AccountCardTitle icon="monitor-smartphone">
            Signed-in devices <span className="account-count">{listed.length}</span>
          </AccountCardTitle>
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
