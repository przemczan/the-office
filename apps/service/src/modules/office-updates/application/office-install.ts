import type { InstallKind } from "../domain/install-kind.js";

/** What `OFFICE_INSTALL` says of how The Office was installed; unset in a checkout. */
export class OfficeInstallSetting {
  constructor(readonly variable: InstallKind | undefined) {}
}
