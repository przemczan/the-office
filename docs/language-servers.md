# Language servers

What gives every session on a Claude Code engine its `LSP` tool ([spec §5.4](spec/5.4-the-engine.md#defaults)): the servers installed on the workstation, found on the session's `PATH`. The arguments each runs with are in `LANGUAGE_SERVERS` (`apps/service/src/modules/engine/domain/language-servers.ts`). What the engine does with them is recorded by the engine check's `engine.lsp-tool` ([engine-check.md](engine-check.md)).

## What is installed

| Server | Command | Version | Comes with |
|---|---|---|---|
| TypeScript and JavaScript | `typescript-language-server` | 6.0.3 | `typescript` 6.0.3, the `tsserver` it falls back on: TypeScript 7 ships none |
| C and C++ | `clangd` | 23.1.0 | |
| Kotlin | `kotlin-lsp` | 263.7084.0 (JetBrains' Kotlin server, pre-release) | its own Java, in the archive's `jbr/`, so no JDK is needed |

The Office's own machine (Ubuntu 24.04 x64) has them since 2026-11-07, approved by Devops: 1.4 GB in `/opt/language-servers`, each command linked into `/usr/local/bin`.

## Repeating it

**Linux:** run `tools/language-servers/install-linux.sh` as root. It needs Node, `curl`, `unzip` and `tar`, checks each download against its pinned SHA-256, and ends by printing each server's version. A version change is a change of that script and of the table above. To remove them, delete `/opt/language-servers` and the three links.

**Windows** (not run yet): into a folder on the `PATH` The Office starts with, say `C:\language-servers`:

1. `npm install --prefix C:\language-servers\typescript --save-exact typescript-language-server@6.0.3 typescript@6.0.3`, and add its `node_modules\.bin` to `PATH`.
2. Unpack `clangd-windows-23.1.0.zip` from <https://github.com/clangd/clangd/releases/tag/23.1.0> (SHA-256 `23412a240756a162e7b98a282f36aa2a23a88db5ce16a0cbc4fef7253768c810`) and add its `bin` to `PATH`.
3. Unpack `kotlin-server-263.7084.0.win.zip` from `https://download.jetbrains.com/language-server/kotlin-server/263.7084.0/` (SHA-256 `be3bc4ef430cde315e6a83900ffb5d9cc454a36aabe9dd3ba7d4141b2d628164`), and make `kotlin-lsp` find its launcher on `PATH`.

Whether the engine starts a `.cmd` command such as `typescript-language-server.cmd` on Windows is not checked yet; The Office finds it by `PATHEXT`.

A server missing from the workstation is left out of new sessions, whose brief says so; nothing else changes. A session keeps the servers it started with on each resume.

## How each behaves

Measured on 2026-11-07 on the Office's own machine, through the pinned engine.

- **TypeScript:** the first answer in a the-office worktree takes about 14 s, while `tsserver` loads the project. `useSyntaxServer: "never"` makes it wait for that: its syntax server would answer at once, stopping a definition at the import line. Writes nothing into the folder.
- **C and C++:** answers in about 2 s. `--background-index=false` keeps `.cache/clangd` out of the folder, so it knows the files open and what they include, and finds no definition across translation units without a `compile_commands.json`.
- **Kotlin:** imports the Gradle project first, running its build scripts, and until that ends, about a minute on a small sample, it answers "No definition found" where it knows better; hover answers sooner. So retry after a first empty answer. At this version `kotlin-lsp.sh` warns that it is deprecated in favour of `bin/intellij-server`, so a version change should try that launcher.

## What to watch

- **Memory (Kotlin):** on a two-file Gradle sample the server peaked at about 1.5 GB resident, and the import left a Gradle daemon of about 760 MB. A server starts at the first LSP call or Edit on a `.kt` file, so each session working in Kotlin has its own, and the machine has 10 GB. The server ends with its session. **The Gradle daemon outlives it** (Gradle's own idle timeout, 3 hours by default); sessions on one Gradle version share it.
- **What a server writes:** Kotlin's import writes `.gradle/` into the folder it opens, which a Gradle project ignores in git, and downloads Gradle and the project's dependencies into `~/.gradle`, its own index going to `~/.cache/JetBrains` (about 550 MB together on the sample). TypeScript and `clangd`, as started here, wrote nothing.
- **What the tool hides:** the engine filters out locations in files git ignores, so a definition in `node_modules` or a generated folder reads "No definition found". A sample to try a server on must not sit in a git-ignored folder.
- **Project code runs:** Gradle build scripts and tsconfig plugins run outside the hook, in read-only sessions too ([spec §6](spec/6-permissions-and-safety.md)).
