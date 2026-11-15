/**
 * What the service asks for in `request.json` (docs/running-the-office.md): the launcher fast-forwards
 * a checkout to a commit or installs a release's tarball, and the Office updater moves a Compose
 * install to a version's image. The launcher and the updater read the same shapes
 * (tools/office-launcher/src/update-folder.ts).
 */
export type OfficeUpdateRequest =
  | { readonly kind: "commit"; readonly target: string }
  | {
      readonly kind: "release";
      readonly version: string;
      readonly from: string;
      readonly tarballUrl: string;
      readonly checksumUrl: string;
    }
  | {
      readonly kind: "container";
      readonly version: string;
      readonly from: string;
      /** The image's repository, without a tag; the updater pulls `<image>:<version>`. */
      readonly image: string;
    };
