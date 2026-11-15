import { Injectable } from "@nestjs/common";
import { installKindOf, type InstallKind } from "../domain/install-kind.js";
import type { OfficeRelease } from "../domain/office-release.js";
import { OfficeReleaseStamp } from "../ports/office-release-stamp.js";
import { OfficeInstallSetting } from "./office-install.js";

/** How The Office running now was installed, and the release it runs, if any. */
@Injectable()
export class InstalledOffice {
  private release: Promise<OfficeRelease | undefined> | undefined;

  constructor(
    private readonly releaseStamp: OfficeReleaseStamp,
    private readonly setting: OfficeInstallSetting,
  ) {}

  /** `OFFICE_INSTALL`, as the launcher or the image set it; unset in a checkout. */
  get variable(): InstallKind | undefined {
    return this.setting.variable;
  }

  async kind(): Promise<InstallKind> {
    return installKindOf(this.setting.variable, (await this.officeRelease()) !== undefined);
  }

  /** The release's stamp, read once; undefined in a checkout. A failed read is tried again. */
  officeRelease(): Promise<OfficeRelease | undefined> {
    this.release ??= this.releaseStamp.read().catch((error: unknown) => {
      this.release = undefined;
      throw error;
    });
    return this.release;
  }
}
