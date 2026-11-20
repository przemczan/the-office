import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "@nestjs/common";

// docs/spec/ of The Office's install, a checkout or a release, from this file in src/ or dist/.
const INSTALLED_FOLDER = fileURLToPath(new URL("../../../../../docs/spec/", import.meta.url));

/** The file a session starts reading the knowledge base at. */
const INDEX_FILE = "README.md";

/**
 * The Office's knowledge base (docs/spec/README.md): the spec, which sessions read about The Office
 * itself, read-only, at its path in the install. An install without it has none, and its Briefs
 * don't name it.
 */
export class KnowledgeBase {
  private static readonly logger = new Logger(KnowledgeBase.name);

  private constructor(
    /** The folder sessions may read; undefined when the install has no knowledge base. */
    readonly folder: string | undefined,
  ) {}

  /** The knowledge base at `folder`, or none, logged once, when `folder` holds no index. */
  static at(folder: string = INSTALLED_FOLDER): KnowledgeBase {
    const resolved = path.resolve(folder);
    if (existsSync(path.join(resolved, INDEX_FILE))) return new KnowledgeBase(resolved);
    KnowledgeBase.logger.warn(
      `No knowledge base at ${resolved}: Briefs won't name it, and sessions can't read it.`,
    );
    return new KnowledgeBase(undefined);
  }

  /** The index's absolute path, which every Brief names; undefined with no knowledge base. */
  get index(): string | undefined {
    return this.folder === undefined ? undefined : path.join(this.folder, INDEX_FILE);
  }

  /** The folders a session reads it in: the knowledge base's, or none. */
  get readableFolders(): readonly string[] {
    return this.folder === undefined ? [] : [this.folder];
  }
}
