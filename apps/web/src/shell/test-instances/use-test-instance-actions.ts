import { useMutation } from "@tanstack/react-query";
import type { TestInstance } from "@the-office/contracts";
import { ApiError } from "../../api/api-client.ts";
import { linkTestBuildFile, openTestInstance, stopTestInstance } from "../../api/test-instances.ts";
import type { RunRelay } from "../devices/run-relays.ts";
import { useNotices, useToast } from "../toasts.tsx";
import type { ShownTestBuildLink } from "./test-build-qr-dialog.tsx";
import {
  launchRefusedTitle,
  openRefusedTitle,
  qrRefusedTitle,
  stoppedToast,
} from "./test-instance-words.ts";

/** One launch of a test target, as the place it is launched from sends it. */
export interface TestInstanceLaunching {
  /** Which row it launches from, as that row's `launchKey`, such as `<project>-<target>`. */
  readonly key: string;
  readonly targetName: string;
  /**
   * Opens the Project device an Install on a device relays from this tab, as the user launches
   * it; null when it relays none, undefined when the browser's picker closed with none picked.
   */
  readonly openRelay?: () => Promise<RunRelay | null | undefined>;
  /** Sends the launch, with the tab relaying its device when it has one. */
  readonly send: (relayTab: string | undefined) => Promise<TestInstance>;
}

/** What a row's actions do, shared by every row and the Log window. */
export interface TestInstanceActions {
  readonly readOnly: boolean;
  /** The `key` of the launch waiting for its answer. */
  readonly launchingKey: string | undefined;
  readonly stoppingId: string | undefined;
  /** `<instance id>/<file name>` while its QR code's link is asked for. */
  readonly linkingFile: string | undefined;
  readonly launch: (launching: TestInstanceLaunching) => void;
  readonly stop: (instance: TestInstance) => void;
  readonly open: (instance: TestInstance) => void;
  readonly showQrCode: (instance: TestInstance, fileName: string) => void;
  readonly showLog: (instance: TestInstance) => void;
}

/**
 * Launch, Stop, Open and a file's QR code. Launch and Stop read the block again on their answer, as
 * their event does; a refusal is a toast with the service's reasons, and the row stays as it was.
 */
export function useTestInstanceActions({
  readOnly,
  readAgain,
  showLink,
}: {
  readonly readOnly: boolean;
  readonly readAgain: () => Promise<void>;
  readonly showLink: (shown: ShownTestBuildLink) => void;
}): Omit<TestInstanceActions, "showLog"> {
  const showToast = useToast();
  const notices = useNotices();
  const refused = (key: string, title: string, error: Error): void =>
    notices.show({ key, title, description: reasonsOf(error) });
  const launching = useMutation({
    mutationFn: async (launch: TestInstanceLaunching) => {
      const relay = launch.openRelay === undefined ? null : await launch.openRelay();
      if (relay === undefined) return undefined;
      try {
        return await launch.send(relay?.relayTab);
      } catch (error) {
        relay?.release();
        throw error;
      }
    },
    onSuccess: () => readAgain(),
    onError: (error, launch) =>
      refused(`test-instance-launch-${launch.key}`, launchRefusedTitle(launch.targetName), error),
  });
  const stopping = useMutation({
    mutationFn: (instance: TestInstance) => stopTestInstance(instance.id),
    onSuccess: async (stopped) => {
      showToast(stoppedToast(stopped.targetName));
      await readAgain();
    },
    onError: (error, instance) =>
      refused(`test-instance-stop-${instance.id}`, `${instance.targetName} can't stop`, error),
  });
  const linking = useMutation({
    mutationFn: ({ instance, fileName }: { instance: TestInstance; fileName: string }) =>
      linkTestBuildFile(instance.id, fileName),
    onSuccess: (link, { fileName }) => showLink({ fileName, link }),
    onError: (error, { instance, fileName }) =>
      refused(`test-build-link-${instance.id}-${fileName}`, qrRefusedTitle(fileName), error),
  });
  return {
    readOnly,
    launchingKey: launching.isPending ? launching.variables.key : undefined,
    stoppingId: stopping.isPending ? stopping.variables.id : undefined,
    linkingFile: linking.isPending
      ? `${linking.variables.instance.id}/${linking.variables.fileName}`
      : undefined,
    showQrCode: (instance, fileName) => linking.mutate({ instance, fileName }),
    launch: (launch) => launching.mutate(launch),
    stop: (instance) => stopping.mutate(instance),
    open: (instance) => {
      // Opened on the click itself, so no popup blocker stops it; pointed at the link once answered.
      const tab = window.open("", "_blank");
      void openInTab(instance, tab).catch((error: unknown) => {
        tab?.close();
        refused(
          `test-instance-open-${instance.id}`,
          openRefusedTitle(instance.targetName),
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    },
  };
}

/** Asks for the instance's hand-off link and points the tab opened for it there. */
async function openInTab(instance: TestInstance, tab: Window | null): Promise<void> {
  const { url } = await openTestInstance(instance.id);
  if (tab === null) {
    window.open(url, "_blank", "noopener");
    return;
  }
  tab.opener = null;
  tab.location.href = url;
}

function reasonsOf(error: Error): string {
  return error instanceof ApiError ? error.reasons.join(" ") : error.message;
}
