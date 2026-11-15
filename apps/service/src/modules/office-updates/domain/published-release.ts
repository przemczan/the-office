/** A file attached to a published release, such as its tarball. */
export interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
}

/** A released version of The Office on GitHub Releases, never a draft or a pre-release. */
export interface PublishedRelease {
  /** As `1.4.0`, without the tag's `v`. */
  readonly version: string;
  readonly name: string;
  readonly publishedAt: Date;
  /** The release's notes, in Markdown. */
  readonly notes: string;
  /** The release's page. */
  readonly url: string;
  readonly assets: readonly ReleaseAsset[];
}

/** Where a release's tarball for Linux on `architecture` and its checksum are downloaded from. */
export interface TarballAssets {
  readonly tarballUrl: string;
  readonly checksumUrl: string;
}

/** The tarball's name, as `tools/release` packs it. */
export function tarballName(version: string, architecture: string): string {
  return `the-office-${version}-linux-${architecture}.tar.gz`;
}

/** The release's tarball for `architecture` and its .sha256; undefined when it lacks either. */
export function tarballAssetsOf(
  { version, assets }: PublishedRelease,
  architecture: string,
): TarballAssets | undefined {
  const tarball = tarballName(version, architecture);
  const urlOf = (name: string) => assets.find((asset) => asset.name === name)?.url;
  const tarballUrl = urlOf(tarball);
  const checksumUrl = urlOf(`${tarball}.sha256`);
  return tarballUrl && checksumUrl ? { tarballUrl, checksumUrl } : undefined;
}
