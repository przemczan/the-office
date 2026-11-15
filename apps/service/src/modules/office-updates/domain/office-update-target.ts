import type { OfficeCommit } from "./office-commit.js";
import { officeVersionWords } from "./office-version.js";

/** What a scheduled Office update installs: a checkout's commit, or a released version. */
export type OfficeUpdateTarget =
  | ({ readonly kind: "commit" } & OfficeCommit)
  | {
      readonly kind: "release";
      readonly version: string;
      readonly name: string;
      readonly publishedAt: Date;
      readonly url: string;
    };

/** The target as the log and the UI name it: a commit shortened, a version whole. */
export function targetWords(target: OfficeUpdateTarget): string {
  return officeVersionWords(target.kind === "commit" ? target.commit : target.version);
}
