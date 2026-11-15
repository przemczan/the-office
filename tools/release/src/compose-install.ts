// The Compose install's files (deploy/compose/, spec §5.1 Defaults, "Installing with Docker
// Compose") as each Office release carries them (docs/releasing.md), apart from the filesystem.

/** The checkout's compose folder, from the repository's root. */
export const COMPOSE_FOLDER = "deploy/compose";

/**
 * Each compose file's release asset, by its name in the compose folder. GitHub renames an asset
 * whose name starts with a dot, so `.env.example` is carried as `the-office.env`.
 */
export const COMPOSE_ASSETS = {
  composeFile: { source: "docker-compose.yml", asset: "docker-compose.yml" },
  envFile: { source: ".env.example", asset: "the-office.env" },
} as const;

const VERSION_LINE = /^OFFICE_VERSION=.*$/gm;

/** `.env.example`'s text with its one `OFFICE_VERSION=` line set to `version`. */
export function stampComposeEnv(template: string, version: string): string {
  const lines = template.match(VERSION_LINE) ?? [];
  if (lines.length !== 1) {
    throw new Error(
      `The compose .env template needs exactly one OFFICE_VERSION= line; it has ${lines.length}.`,
    );
  }
  return template.replace(VERSION_LINE, `OFFICE_VERSION=${version}`);
}
