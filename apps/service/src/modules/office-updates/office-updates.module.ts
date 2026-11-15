import { join } from "node:path";
import { Module, type DynamicModule } from "@nestjs/common";
import {
  currentOperatingSystem,
  processorArchitecture,
} from "../../platform/os/current-operating-system.js";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { DockerCliOfficeContainer } from "./adapters/docker/docker-cli-office-container.js";
import { UpdaterHandOff } from "./adapters/docker/updater-hand-off.js";
import { FilesystemOfficeReleaseStamp } from "./adapters/filesystem/filesystem-office-release-stamp.js";
import { FilesystemUpdateFolder } from "./adapters/filesystem/filesystem-update-folder.js";
import { LauncherHandOff } from "./adapters/filesystem/launcher-hand-off.js";
import { CommandLineOfficeCheckout } from "./adapters/git/command-line-office-checkout.js";
import { GitHubOfficeReleases } from "./adapters/github/github-office-releases.js";
import { OfficeUpdateRefusalsFilter } from "./adapters/http/office-update-refusals.filter.js";
import { OfficeUpdatesController } from "./adapters/http/office-updates.controller.js";
import { OfficeUpdateWebEvents } from "./adapters/websocket/office-update-web-events.js";
import { OfficeInstallSetting } from "./application/office-install.js";
import { OfficeUpdates } from "./application/office-updates.js";
import { BusyWorkModule } from "./busy-work.module.js";
import type { InstallKind } from "./domain/install-kind.js";
import { OfficeCheckout } from "./ports/office-checkout.js";
import { OfficeContainer } from "./ports/office-container.js";
import { OfficeReleaseStamp } from "./ports/office-release-stamp.js";
import { OfficeReleases } from "./ports/office-releases.js";
import { UpdateFolder } from "./ports/update-folder.js";
import { UpdateHandOff } from "./ports/update-hand-off.js";
import { UpdateSystem } from "./ports/update-system.js";

export interface OfficeUpdatesOptions {
  /**
   * The folder The Office's service runs from: its own git checkout, or an Office release, which
   * carries its stamp there.
   */
  readonly checkout: string;
  /** The folder the launcher shares with the service; absent without the launcher. */
  readonly updateFolder: string | undefined;
  /** `OFFICE_INSTALL`: how The Office was installed; unset in a checkout. */
  readonly install?: InstallKind | undefined;
  /** Where a container keeps its update folder, for the Office updater. */
  readonly officeDataDirectory?: string;
  /** GitHub's API, where a release or a container reads GitHub Releases. */
  readonly gitHubApiUrl?: string;
}

const GITHUB_API_URL = "https://api.github.com";

@Module({})
export class OfficeUpdatesModule {
  static register({
    checkout,
    updateFolder,
    install,
    officeDataDirectory,
    gitHubApiUrl = GITHUB_API_URL,
  }: OfficeUpdatesOptions): DynamicModule {
    // A container has no launcher: its update folder is the Office updater's, in the data directory.
    const containerData = install === "container" ? officeDataDirectory : undefined;
    const folder = new FilesystemUpdateFolder(
      updateFolder ?? (containerData === undefined ? undefined : join(containerData, "update")),
    );
    const container = new DockerCliOfficeContainer();
    return {
      module: OfficeUpdatesModule,
      imports: [ScheduleModule, BusyWorkModule],
      controllers: [OfficeUpdatesController],
      providers: [
        { provide: OfficeCheckout, useValue: new CommandLineOfficeCheckout(checkout) },
        { provide: OfficeReleaseStamp, useValue: new FilesystemOfficeReleaseStamp(checkout) },
        { provide: OfficeReleases, useValue: new GitHubOfficeReleases(gitHubApiUrl) },
        { provide: OfficeContainer, useValue: container },
        { provide: UpdateFolder, useValue: folder },
        {
          provide: UpdateHandOff,
          useFactory: (updates: UpdateFolder, office: OfficeContainer) =>
            containerData === undefined
              ? new LauncherHandOff(updates)
              : new UpdaterHandOff(updates, office, containerData),
          inject: [UpdateFolder, OfficeContainer],
        },
        {
          provide: UpdateSystem,
          useValue: {
            refusal: currentOperatingSystem().officeUpdateRefusal,
            architecture: processorArchitecture(),
          },
        },
        { provide: OfficeInstallSetting, useValue: new OfficeInstallSetting(install) },
        OfficeUpdates,
        OfficeUpdateRefusalsFilter,
        OfficeUpdateWebEvents,
      ],
      exports: [OfficeUpdates],
    };
  }
}
