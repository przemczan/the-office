import type { CommitTree, TreeEntry, TreePathKind } from "../../ports/git.js";
import type { GitProcess } from "./git-process.js";

/** `<mode> <type> <object>\t<name>`, as `ls-tree -z` prints each entry. */
const TREE_LINE = /^(\d{6}) \w+ [0-9a-f]+\t(.+)$/s;

export function commitTreeOf(git: GitProcess, repository: string, commit: string): CommitTree {
  // `<commit>:` names the top-level tree, `<commit>:<path>` what is at that path.
  const object = (path: string): string => `${commit}:${path}`;
  return {
    commit,
    kindOf: async (path) => {
      if (path === "") return "folder";
      // The entry itself, by its mode: a submodule's commit isn't in these objects to ask for its type.
      // Literal, as a path is someone's words and `:(…)` would otherwise make git refuse it.
      const output = await git.output({
        folder: repository,
        gitArguments: ["ls-tree", "-z", commit, "--", `:(literal)${path}`],
      });
      const entry = output.split("\0").find((line) => line !== "");
      return entry === undefined ? "missing" : pathKindOf(treeEntryOf(entry).kind);
    },
    entriesOf: async (folder) => {
      const output = await git.output({
        folder: repository,
        gitArguments: ["ls-tree", "-z", object(folder)],
      });
      return output
        .split("\0")
        .filter((line) => line !== "")
        .map(treeEntryOf);
    },
    textOf: (path) =>
      git.output({ folder: repository, gitArguments: ["cat-file", "blob", object(path)] }),
    sizeOf: async (path) => {
      const output = await git.output({
        folder: repository,
        gitArguments: ["cat-file", "-s", object(path)],
      });
      return Number(output.trim());
    },
    bytesOf: (path) =>
      git.bytes({ folder: repository, gitArguments: ["cat-file", "blob", object(path)] }),
  };
}

/** A link is never followed, so it is read as the file it is. */
function pathKindOf(kind: TreeEntry["kind"]): TreePathKind {
  return kind === "link" ? "file" : kind;
}

function treeEntryOf(line: string): TreeEntry {
  const match = TREE_LINE.exec(line);
  if (!match?.[1] || match[2] === undefined)
    throw new Error(`git ls-tree printed an unknown line: ${line}`);
  return { name: match[2], kind: kindOfMode(match[1]) };
}

function kindOfMode(mode: string): TreeEntry["kind"] {
  switch (mode) {
    case "040000":
      return "folder";
    case "120000":
      return "link";
    case "160000":
      return "submodule";
    default:
      return "file";
  }
}
