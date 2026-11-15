// A fake Debian/Ubuntu machine for install.sh's whole runs: a folder standing in for `/`
// (THE_OFFICE_INSTALL_ROOT), stubs on PATH for every system command the installer runs, each
// logging its call and answering from a state folder, and GitHub Releases served from files.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INSTALL_SCRIPT, type BashResult } from "./install-script.fixtures.ts";

export const REPOSITORY = "przemczan/the-office";

/** Each vendor's signing key, by a part of its address, with the fingerprint install.sh expects. */
const SIGNING_KEYS: Readonly<Record<string, string>> = {
  "download.docker.com": "9DC858229FC7DD38854AE2D88D81803C0EBFCD88",
  "www.postgresql.org": "B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8",
  "deb.nodesource.com": "6F71F525282841EEDAF851B42F59B5F99B1BE0B4",
};

// The machine's own commands the installer and the stubs use; PATH holds these and the stubs
// alone, so no test reaches the real apt, systemd, Docker or PostgreSQL.
const REAL_COMMANDS = [
  "awk",
  "basename",
  "bash",
  "cat",
  "chmod",
  "cmp",
  "cp",
  "cut",
  "date",
  "dirname",
  "env",
  "find",
  "grep",
  "gzip",
  "head",
  "install",
  "ln",
  "ls",
  "mkdir",
  "mktemp",
  "mv",
  "readlink",
  "rm",
  "rmdir",
  "sed",
  "sha256sum",
  "sleep",
  "stat",
  "tail",
  "tar",
  "touch",
  "tr",
] as const;

export interface OsRelease {
  readonly id: string;
  readonly versionId: string;
  readonly codename: string;
}

export const DEBIAN_13: OsRelease = { id: "debian", versionId: "13", codename: "trixie" };

export interface FakeMachine {
  /** The folder standing in for `/`. */
  readonly root: string;
  /** A path on the fake machine, such as `/etc/the-office/office.env`. */
  path(systemPath: string): string;
  /** Runs install.sh's main with `args`, as root unless `uid` says otherwise. */
  install(args?: readonly string[], environment?: NodeJS.ProcessEnv): BashResult;
  /** Runs a copy of install.sh stamped as tools/release/prepare.sh does, piped into bash. */
  installStamped(version: string): BashResult;
  /** The commands the stubs were called with since the last `clearCalls`, one line each. */
  calls(): string[];
  clearCalls(): void;
  /** Publishes a release on the fake GitHub, its tarball holding a setup-token.js that answers. */
  publishRelease(version: string, options?: { readonly checksum?: string }): void;
  /** The release GitHub's releases/latest leads to. */
  setLatest(version: string): void;
  /** A state flag the stubs read, such as `first-user` or `docker-info-fails`. */
  setFlag(name: string, on?: boolean): void;
  setState(name: string, value: string): void;
  readState(name: string): string;
  /** Docker already on the machine, before the installer runs. */
  installDocker(): void;
  /** A file on the fake machine, read as text. */
  read(systemPath: string): string;
  remove(): void;
}

export function fakeMachine(osRelease: OsRelease = DEBIAN_13): FakeMachine {
  const base = mkdtempSync(join(tmpdir(), "office-install-"));
  const root = join(base, "root");
  const stubs = join(base, "stubs");
  const state = join(base, "state");
  const releases = join(base, "releases");
  const commands = join(base, "commands");
  for (const folder of [
    root,
    stubs,
    state,
    releases,
    commands,
    join(root, "run/systemd/system"),
    join(root, "etc"),
  ]) {
    mkdirSync(folder, { recursive: true });
  }
  writeFileSync(
    join(root, "etc/os-release"),
    `ID=${osRelease.id}\nVERSION_ID="${osRelease.versionId}"\nVERSION_CODENAME=${osRelease.codename}\n`,
  );
  writeStubs(stubs, root);
  linkRealCommands(commands);

  function runBash(
    args: readonly string[],
    script: string | undefined,
    environment: NodeJS.ProcessEnv,
  ): BashResult {
    const result = spawnSync("bash", args, {
      encoding: "utf8",
      input: script,
      stdio: [script === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: {
        PATH: `${stubs}:${commands}`,
        HOME: base,
        THE_OFFICE_INSTALL_ROOT: root,
        THE_OFFICE_INSTALL_HEALTH_SECONDS: "0",
        FAKE_STATE: state,
        FAKE_STUBS: stubs,
        FAKE_RELEASES: releases,
        FAKE_NODE: process.execPath,
        ...environment,
      },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  const machine: FakeMachine = {
    root,
    path: (systemPath) => join(root, systemPath),
    install(args = [], environment = {}) {
      return runBash([INSTALL_SCRIPT, ...args], undefined, environment);
    },
    installStamped(version) {
      const stamped = readFileSync(INSTALL_SCRIPT, "utf8")
        .replaceAll("@OFFICE_VERSION@", version)
        .replaceAll("@OFFICE_REPOSITORY@", REPOSITORY);
      return runBash([], stamped, {});
    },
    calls() {
      const log = join(state, "calls.log");
      return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    },
    clearCalls: () => rmSync(join(state, "calls.log"), { force: true }),
    publishRelease(version, options = {}) {
      const folder = join(releases, version);
      const stage = join(base, "stage", version);
      const top = join(stage, `the-office-${version}`);
      mkdirSync(join(top, "apps/service/dist"), { recursive: true });
      mkdirSync(join(top, "tools/office-launcher/src"), { recursive: true });
      writeFileSync(
        join(top, "office-release.json"),
        `${JSON.stringify({ version, commit: "0".repeat(40) }, null, 2)}\n`,
      );
      writeFileSync(join(top, "tools/office-launcher/src/main.ts"), "");
      writeFileSync(join(top, "apps/service/dist/setup-token.js"), SETUP_TOKEN_JS);
      mkdirSync(folder, { recursive: true });
      for (const arch of ["x64", "arm64"]) {
        const name = `the-office-${version}-linux-${arch}.tar.gz`;
        const tarball = join(folder, name);
        execFileSync("tar", [
          "--create",
          "--gzip",
          "--file",
          tarball,
          "--directory",
          stage,
          `the-office-${version}`,
        ]);
        const sha256 =
          options.checksum ?? createHash("sha256").update(readFileSync(tarball)).digest("hex");
        writeFileSync(`${tarball}.sha256`, `${sha256}  ${name}\n`);
      }
    },
    setLatest: (version) => writeFileSync(join(state, "latest"), version),
    setFlag(name, on = true) {
      if (on) writeFileSync(join(state, name), "");
      else rmSync(join(state, name), { force: true });
    },
    setState: (name, value) => writeFileSync(join(state, name), value),
    readState: (name) => readFileSync(join(state, name), "utf8"),
    installDocker: () => writeDockerStub(stubs),
    read: (systemPath) => readFileSync(join(root, systemPath), "utf8"),
    remove: () => rmSync(base, { recursive: true, force: true }),
  };
  return machine;
}

function linkRealCommands(commands: string): void {
  for (const command of REAL_COMMANDS) {
    const found = execFileSync("bash", ["-c", 'command -v "$1"', "bash", command], {
      encoding: "utf8",
    }).trim();
    symlinkSync(found, join(commands, command));
  }
}

// The release's setup-token.js: a token while no user exists, as apps/service's setup-token does.
const SETUP_TOKEN_JS = `const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const state = process.env.FAKE_STATE;
appendFileSync(state + "/setup-token-env", process.env.DATABASE_URL + " " + process.env.OFFICE_DATA_DIR + "\\n");
if (existsSync(state + "/first-user")) {
  console.error("The Office already has its first user, so it takes no setup token.");
  process.exit(1);
}
if (existsSync(state + "/setup-token-fails")) {
  console.error("connect ECONNREFUSED 127.0.0.1:5432");
  process.exit(1);
}
const count = existsSync(state + "/tokens") ? Number(readFileSync(state + "/tokens", "utf8")) + 1 : 1;
writeFileSync(state + "/tokens", String(count));
console.log("token-" + count);
`;

const LOG_CALL = `printf '%s\\n' "$(basename "$0") $*" >>"$FAKE_STATE/calls.log"`;

function writeStub(stubs: string, name: string, body: string): void {
  const path = join(stubs, name);
  writeFileSync(path, `#!/usr/bin/env bash\n${LOG_CALL}\n${body}\n`);
  chmodSync(path, 0o755);
}

function writeDockerStub(stubs: string): void {
  writeStub(
    stubs,
    "docker",
    `case "$1" in
  info) [[ ! -f $FAKE_STATE/docker-info-fails ]] ;;
  compose) [[ ! -f $FAKE_STATE/docker-lacks-compose ]] ;;
  buildx) [[ ! -f $FAKE_STATE/docker-lacks-buildx ]] ;;
  # The run environments' leftovers, listed by their label; an image is listed once for each tag.
  ps) [[ $* == *label=office.managed=true*label=office.instance=* ]] && printf 'container-1\\ncontainer-2\\n'; exit 0 ;;
  network | volume) [[ $2 == ls && $* == *label=office.managed=true*label=office.instance=* ]] && echo "$1-1"; exit 0 ;;
  image) [[ $2 == ls && $* == *label=office.managed=true*label=office.instance=* ]] && printf 'image-1\\nimage-1\\n'; exit 0 ;;
esac`,
  );
}

function writeStubs(stubs: string, root: string): void {
  writeStub(stubs, "id", `[[ $1 == -u ]] && cat "$FAKE_STATE/uid" 2>/dev/null || echo 0`);
  writeStub(
    stubs,
    "dpkg",
    `[[ $1 == --print-architecture ]] && { cat "$FAKE_STATE/arch" 2>/dev/null || echo amd64; }`,
  );
  writeStub(
    stubs,
    "dpkg-query",
    `package=\${!#}
grep -qx "$package" "$FAKE_STATE/packages" 2>/dev/null || exit 1
printf 'install ok installed'`,
  );
  writeStub(
    stubs,
    "apt-get",
    `[[ $1 == install ]] || exit 0
for argument in "$@"; do
  [[ $argument == install || $argument == -* ]] && continue
  package=\${argument%%=*}
  echo "$package" >>"$FAKE_STATE/packages"
  case $package in
    nodejs)
      mkdir -p "${root}/usr/bin"
      printf '#!/usr/bin/env bash\\necho v22.20.0\\n' >"${root}/usr/bin/node"
      chmod 755 "${root}/usr/bin/node"
      ;;
    docker-ce)
      cp "$FAKE_STUBS/.docker" "$FAKE_STUBS/docker"
      ;;
    postgresql-18)
      echo "18 main 5432 online postgres /var/lib/postgresql/18/main /var/log/postgresql/postgresql-18-main.log" >"$FAKE_STATE/clusters"
      ;;
  esac
done`,
  );
  // apt-get's install of docker-ce copies this in as docker.
  writeDockerStub(stubs);
  execFileSync("mv", [join(stubs, "docker"), join(stubs, ".docker")]);
  writeStub(stubs, "apt-mark", "");
  writeStub(
    stubs,
    "systemctl",
    `case "$1" in
  is-active) [[ -f $FAKE_STATE/running ]] ;;
  start|restart) [[ \${!#} == the-office ]] && touch "$FAKE_STATE/running"; exit 0 ;;
  disable) [[ $2 == --now ]] && rm -f "$FAKE_STATE/running"; exit 0 ;;
esac`,
  );
  writeStub(
    stubs,
    "systemd-detect-virt",
    `[[ -f $FAKE_STATE/virt ]] && cat "$FAKE_STATE/virt" || { echo none; exit 1; }`,
  );
  writeStub(stubs, "useradd", `echo "\${!#}" >>"$FAKE_STATE/users"`);
  writeStub(stubs, "usermod", "");
  writeStub(
    stubs,
    "userdel",
    `grep -vx "\${!#}" "$FAKE_STATE/users" >"$FAKE_STATE/users.left" 2>/dev/null
mv "$FAKE_STATE/users.left" "$FAKE_STATE/users"`,
  );
  writeStub(stubs, "getent", `[[ $1 == passwd ]] && grep -qx "$2" "$FAKE_STATE/users" 2>/dev/null`);
  // chown records each path's owner, as the tests run unprivileged, and stat -c %U answers it.
  writeStub(
    stubs,
    "chown",
    `owner=""
for argument in "$@"; do
  [[ $argument == -* ]] && continue
  if [[ -z $owner ]]; then owner=\${argument%%:*}; else echo "$argument $owner" >>"$FAKE_STATE/owners"; fi
done`,
  );
  writeStub(
    stubs,
    "stat",
    `if [[ $1 == -c && $2 == %U ]]; then
  owner=$(awk -v path="$3" '$1 == path { owner = $2 } END { print owner }' "$FAKE_STATE/owners" 2>/dev/null)
  [[ -n $owner ]] && echo "$owner" && exit 0
fi
PATH=\${PATH#*:} exec stat "$@"`,
  );
  writeStub(stubs, "journalctl", `echo "the-office[1234]: the journal's last lines"`);
  writeStub(stubs, "hostname", `[[ $1 == -I ]] && echo "192.168.1.20 fd00::20 "`);
  writeStub(
    stubs,
    "ss",
    `port=\${!#}
port=\${port##*:}
grep -qx "$port" "$FAKE_STATE/ports-in-use" 2>/dev/null && echo "LISTEN 0 511 0.0.0.0:$port 0.0.0.0:*"
exit 0`,
  );
  writeStub(stubs, "pg_lsclusters", `cat "$FAKE_STATE/clusters" 2>/dev/null; exit 0`);
  writeStub(
    stubs,
    "pg_createcluster",
    `echo "18 main 5432 online postgres /var/lib/postgresql/18/main /var/log/postgresql/postgresql-18-main.log" >"$FAKE_STATE/clusters"`,
  );
  writeStub(
    stubs,
    "gpg",
    `fingerprint=$(sed -n 's/^KEY //p' "\${!#}")
echo "pub:-:4096:1:0000000000000000:0:::-:::scESC::::::23::0:"
echo "fpr:::::::::$fingerprint:"`,
  );
  writeStub(
    stubs,
    "runuser",
    `shift 3 # -u <user> --
if [[ $1 == psql ]]; then
  sql=""
  while (($# > 0)); do
    [[ $1 == -c ]] && sql=$2
    shift
  done
  [[ -z $sql ]] && sql=$(cat)
  echo "$sql" >>"$FAKE_STATE/sql.log"
  case $sql in
    *pg_roles*) [[ -f $FAKE_STATE/role ]] && echo 1 ;;
    *pg_database*) [[ -f $FAKE_STATE/database ]] && echo 1 ;;
    "create role"*) touch "$FAKE_STATE/role" ;;
    "create database"*) touch "$FAKE_STATE/database" ;;
    "drop database"*) rm -f "$FAKE_STATE/database" ;;
    "drop role"*) rm -f "$FAKE_STATE/role" ;;
  esac
  exit 0
fi
command=()
for argument in "$@"; do
  [[ $argument == /usr/bin/node ]] && argument=$FAKE_NODE
  command+=("$argument")
done
exec "\${command[@]}"`,
  );
  const keys = Object.entries(SIGNING_KEYS)
    .map(([host, fingerprint]) => `  *${host}*) echo "KEY ${fingerprint}" >"$output" ;;`)
    .join("\n");
  writeStub(
    stubs,
    "curl",
    `output="" url=""
while (($# > 0)); do
  case $1 in
    -o) output=$2; shift 2 ;;
    -w|--max-time) shift 2 ;;
    -*) shift ;;
    *) url=$1; shift ;;
  esac
done
case $url in
  */api/health)
    [[ -f $FAKE_STATE/running && ! -f $FAKE_STATE/never-healthy ]] || exit 7
    echo "$url" >>"$FAKE_STATE/health-urls"
    echo '{"status":"ok","database":"up"}'
    ;;
  https://github.com/${REPOSITORY}/releases/latest)
    echo "https://github.com/${REPOSITORY}/releases/tag/v$(cat "$FAKE_STATE/latest")"
    ;;
  https://github.com/${REPOSITORY}/releases/download/v*)
    rest=\${url#*/download/v}
    cp "$FAKE_RELEASES/\${rest%%/*}/\${rest#*/}" "$output" 2>/dev/null || exit 22
    ;;
${keys}
  *) exit 6 ;;
esac`,
  );
}
