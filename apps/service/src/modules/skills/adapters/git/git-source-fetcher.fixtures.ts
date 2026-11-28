import type { ProviderOverride } from "../../../../../test/test-application.js";
import { OfficeIdentity } from "../../../office-identity/index.js";
import type { RemoteRef } from "../../domain/installed-source.js";
import type { SourceFolder } from "../../domain/source-skills.js";
import {
  SourceFetcher,
  SourceNotFetched,
  type SourceDiffRead,
  type SourceRead,
} from "../../ports/source-fetcher.js";
import { GitSourceFetcher } from "./git-source-fetcher.js";

/**
 * The real Sources, but only the test's own: the skill update check reads the Source of every
 * installed skill on the shared database, so without this one file's check would note another
 * file's updates first and run git in its temporary Sources (apps/service/docs/testing.md). Any
 * other Source can't be read, which the check logs and skips.
 */
export class OwnSourcesFetcher extends GitSourceFetcher {
  constructor(
    identity: OfficeIdentity,
    private readonly ownSourceUrls: () => readonly string[],
  ) {
    super(identity);
  }

  override async refs(url: string): Promise<readonly RemoteRef[]> {
    this.checkOwn(url);
    return super.refs(url);
  }

  override async skillFolders(read: SourceRead): Promise<readonly SourceFolder[]> {
    this.checkOwn(read.url);
    return super.skillFolders(read);
  }

  override async diff(read: SourceDiffRead): Promise<string> {
    this.checkOwn(read.url);
    return super.diff(read);
  }

  private checkOwn(url: string): void {
    if (!this.ownSourceUrls().includes(url)) {
      throw new SourceNotFetched(`${url} is another test's Source.`);
    }
  }
}

/** The Sources as the test sees them: only those whose URLs `ownSourceUrls` gives can be read. */
export function ownSources(ownSourceUrls: () => readonly string[]): ProviderOverride {
  return {
    provide: SourceFetcher,
    useFactory: (identity: OfficeIdentity) => new OwnSourcesFetcher(identity, ownSourceUrls),
    inject: [OfficeIdentity],
  };
}
