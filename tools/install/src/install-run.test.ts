import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fakeMachine, type FakeMachine, type OsRelease } from "./fake-machine.fixtures.ts";

const DATABASE_URL =
  /^DATABASE_URL=postgres:\/\/office:([A-Za-z0-9]{32})@127\.0\.0\.1:5432\/the_office$/m;

let machine: FakeMachine;

function freshMachine(osRelease?: OsRelease): FakeMachine {
  const created = fakeMachine(osRelease);
  created.publishRelease("1.2.0");
  created.setLatest("1.2.0");
  return created;
}

function installed(args: readonly string[] = [], environment: NodeJS.ProcessEnv = {}): string {
  const result = machine.install(args, environment);
  assert.equal(result.status, 0, `install.sh failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function refused(args: readonly string[] = [], environment: NodeJS.ProcessEnv = {}): string {
  const result = machine.install(args, environment);
  assert.notEqual(result.status, 0, `install.sh passed:\n${result.stdout}`);
  return result.stderr;
}

function mode(systemPath: string): string {
  return (statSync(machine.path(systemPath)).mode & 0o777).toString(8);
}

function currentRelease(): string {
  return readlinkSync(machine.path("/opt/the-office/current"));
}

function passwordIn(envFile: string): string {
  return DATABASE_URL.exec(envFile)?.[1] ?? "";
}

function callsTo(command: string): string[] {
  return machine.calls().filter((call) => call.startsWith(`${command} `));
}

function assertNothingChanged(): void {
  assert.equal(existsSync(machine.path("/var/log")), false);
  assert.equal(existsSync(machine.path("/etc/the-office")), false);
  assert.deepEqual(callsTo("apt-get"), []);
}

describe("a fresh install", () => {
  beforeEach(() => (machine = freshMachine()));
  afterEach(() => machine.remove());

  it("installs what's missing, The Office's release, its user, database, office.env and unit, and prints the token", () => {
    const printed = installed();

    const installs = callsTo("apt-get").filter((call) => call.startsWith("apt-get install"));
    assert.deepEqual(installs, [
      "apt-get install -y --no-install-recommends ca-certificates curl gnupg git openssh-client",
      "apt-get install -y --no-install-recommends nodejs",
      "apt-get install -y --no-install-recommends docker-ce=5:29.9.3-1~debian.13~trixie docker-ce-cli=5:29.9.3-1~debian.13~trixie containerd.io=2.4.2-3~debian.13~trixie docker-buildx-plugin=0.38.1-1~debian.13~trixie docker-compose-plugin=5.7.0-1~debian.13~trixie",
      "apt-get install -y --no-install-recommends postgresql-18",
    ]);
    assert.deepEqual(callsTo("apt-mark"), [
      "apt-mark hold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin",
    ]);
    assert.match(machine.read("/etc/apt/sources.list.d/docker.sources"), /^Suites: trixie$/m);
    assert.match(machine.read("/etc/apt/sources.list.d/pgdg.sources"), /^Suites: trixie-pgdg$/m);
    assert.match(
      machine.read("/etc/apt/sources.list.d/nodesource.sources"),
      /^URIs: https:\/\/deb\.nodesource\.com\/node_22\.x$/m,
    );

    assert.deepEqual(callsTo("useradd"), [
      "useradd --system --user-group --create-home --home-dir /home/the-office --shell /bin/bash the-office",
    ]);
    assert.deepEqual(callsTo("usermod"), ["usermod -aG docker the-office"]);

    assert.equal(lstatSync(machine.path("/opt/the-office/current")).isSymbolicLink(), true);
    assert.equal(currentRelease(), "releases/1.2.0");
    assert.equal(
      existsSync(machine.path("/opt/the-office/releases/1.2.0/office-release.json")),
      true,
    );
    assert.equal(existsSync(machine.path("/opt/the-office/releases/.unpack-1.2.0")), false);
    assert.ok(
      callsTo("chown").includes(
        `chown -R the-office:the-office ${machine.path("/opt/the-office")}`,
      ),
    );

    assert.equal(mode("/var/lib/the-office"), "750");
    assert.ok(
      callsTo("chown").includes(
        `chown the-office:the-office ${machine.path("/var/lib/the-office")}`,
      ),
    );

    const sql = machine.readState("sql.log");
    assert.match(sql, /^create role office with login password '[A-Za-z0-9]{32}';$/m);
    assert.match(sql, /^create database the_office owner office$/m);

    const envFile = machine.read("/etc/the-office/office.env");
    assert.match(envFile, /^OFFICE_HOST=127\.0\.0\.1$/m);
    assert.match(envFile, /^OFFICE_PORT=4310$/m);
    assert.match(envFile, /^OFFICE_DATA_DIR=\/var\/lib\/the-office$/m);
    assert.match(envFile, DATABASE_URL);
    assert.doesNotMatch(envFile, /OTEL_|OFFICE_INSTALL/);
    assert.equal(mode("/etc/the-office"), "700");
    assert.equal(mode("/etc/the-office/office.env"), "600");

    const unit = machine.read("/etc/systemd/system/the-office.service");
    assert.match(unit, /^User=the-office$/m);
    assert.match(
      unit,
      /^ExecStart=\/usr\/bin\/node \/opt\/the-office\/current\/tools\/office-launcher\/src\/main\.ts$/m,
    );
    assert.match(unit, /^EnvironmentFile=\/etc\/the-office\/office\.env$/m);
    assert.match(unit, /^KillMode=mixed$/m);
    assert.match(unit, /^TimeoutStopSec=15min$/m);

    const systemctl = callsTo("systemctl");
    assert.ok(systemctl.includes("systemctl daemon-reload"));
    assert.ok(systemctl.includes("systemctl enable --now postgresql@18-main"));
    assert.ok(systemctl.includes("systemctl enable the-office"));
    assert.ok(systemctl.includes("systemctl restart the-office"));
    // The token is made before the start, so the service's first start prints none, with office.env's values.
    const calls = machine.calls();
    assert.ok(
      calls.findIndex((call) => call.startsWith("runuser -u the-office -- /usr/bin/node ")) <
        calls.indexOf("systemctl restart the-office"),
    );
    // The database password reaches it through the environment, never a command line.
    const password = passwordIn(envFile);
    assert.deepEqual(
      calls.filter((call) => call.includes(password)),
      [],
    );
    assert.equal(
      machine.readState("setup-token-env").trim(),
      `${envFile.match(DATABASE_URL)?.[0].slice("DATABASE_URL=".length)} /var/lib/the-office`,
    );
    assert.equal(machine.readState("health-urls").trim(), "http://127.0.0.1:4310/api/health");

    assert.match(printed, /^The Office 1\.2\.0 is running\.$/m);
    assert.match(printed, /^Open: http:\/\/127\.0\.0\.1:4310$/m);
    assert.match(printed, /^Setup token: token-1$/m);
    assert.match(printed, /prints a new one/);
    assert.ok(existsSync(machine.path("/var/log/the-office-install.log")));
  });

  it("takes the answers from flags and the environment without asking, and opens at the machine's address", () => {
    const printed = installed(["--host", "0.0.0.0", "--yes"], {
      OFFICE_PORT: "4400",
      OFFICE_DATA_DIR: "/srv/office",
    });
    const envFile = machine.read("/etc/the-office/office.env");
    assert.match(envFile, /^OFFICE_HOST=0\.0\.0\.0$/m);
    assert.match(envFile, /^OFFICE_PORT=4400$/m);
    assert.match(envFile, /^OFFICE_DATA_DIR=\/srv\/office$/m);
    assert.equal(mode("/srv/office"), "750");
    assert.match(printed, /^Open: http:\/\/192\.168\.1\.20:4400$/m);
    assert.equal(machine.readState("health-urls").trim(), "http://127.0.0.1:4400/api/health");
  });

  it("asks for the address, port and data folder at the terminal, again for a wrong one, and confirms", () => {
    mkdirSync(machine.path("/dev"));
    writeFileSync(machine.path("/dev/tty"), "\n80\n4500\n/srv/the-office\ny\n");
    const result = machine.install();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /80 isn't a port from 1024 to 65535\./);
    const envFile = machine.read("/etc/the-office/office.env");
    assert.match(envFile, /^OFFICE_HOST=127\.0\.0\.1$/m);
    assert.match(envFile, /^OFFICE_PORT=4500$/m);
    assert.match(envFile, /^OFFICE_DATA_DIR=\/srv\/the-office$/m);
  });

  it("stops when the user doesn't confirm, before installing anything", () => {
    mkdirSync(machine.path("/dev"));
    writeFileSync(machine.path("/dev/tty"), "\n\n\nn\n");
    refused();
    assert.deepEqual(callsTo("apt-get"), []);
  });

  it("piped into bash, a stamped copy installs its own version, not the newest", () => {
    machine.publishRelease("1.1.0");
    const result = machine.installStamped("1.1.0");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(currentRelease(), "releases/1.1.0");
    assert.ok(!machine.calls().some((call) => call.includes("releases/latest")));
  });

  it("installs the version given instead of the newest release", () => {
    machine.publishRelease("1.1.0");
    installed(["--version", "v1.1.0"]);
    assert.equal(currentRelease(), "releases/1.1.0");
  });

  it("refuses a value that isn't valid, and a port already taken, before changing anything", () => {
    assert.match(refused(["--host", "localhost"]), /localhost isn't an IP address/);
    assert.match(refused(["--port", "99999"]), /99999 isn't a port/);
    assert.match(refused(["--data-dir", "relative"]), /relative isn't an absolute folder/);
    mkdirSync(machine.path("/srv/taken"), { recursive: true });
    writeFileSync(machine.path("/srv/taken/someone-else.txt"), "");
    assert.match(refused(["--data-dir", "/srv/taken"]), /\/srv\/taken isn't empty and belongs to/);
    machine.setState("ports-in-use", "4310\n");
    assert.match(refused(), /Port 4310 is already in use/);
    assert.deepEqual(callsTo("apt-get"), []);
    assert.equal(existsSync(machine.path("/opt/the-office")), false);
  });

  it("leaves current untouched when the tarball doesn't match its sha256", () => {
    machine.publishRelease("1.2.0", { checksum: "0".repeat(64) });
    assert.match(refused(), /doesn't match its sha256/);
    assert.equal(existsSync(machine.path("/opt/the-office/current")), false);
  });

  it("stops when the release isn't on GitHub, leaving current untouched", () => {
    assert.match(refused(["--version", "9.9.9"]), /this failed: curl/);
    assert.equal(existsSync(machine.path("/opt/the-office/current")), false);
  });

  it("exits non-zero, with the journal, when The Office doesn't report its database up", () => {
    machine.setFlag("never-healthy");
    const stderr = refused();
    assert.match(
      stderr,
      /didn't report its database up at http:\/\/127\.0\.0\.1:4310\/api\/health/,
    );
    assert.match(stderr, /the journal's last lines/);
    assert.match(stderr, /journalctl -u the-office/);
  });

  it("fails when the setup token can't be made for another reason than a user existing", () => {
    machine.setFlag("setup-token-fails");
    assert.match(refused(), /setup token couldn't be made:\nconnect ECONNREFUSED/);
    assert.ok(!callsTo("systemctl").includes("systemctl restart the-office"));
  });
});

describe("a rerun", () => {
  beforeEach(() => {
    machine = freshMachine();
    installed();
    machine.clearCalls();
  });
  afterEach(() => machine.remove());

  it("keeps the answers, password, version and the user's lines, installs nothing and restarts nothing", () => {
    const before = machine.read("/etc/the-office/office.env");
    appendFileSync(
      machine.path("/etc/the-office/office.env"),
      "OFFICE_PUBLIC_ADDRESS=https://office.example.com\n",
    );
    machine.publishRelease("1.3.0");
    machine.setLatest("1.3.0");
    // Its own port, taken by The Office itself.
    machine.setState("ports-in-use", "4310\n");

    const printed = installed();

    assert.deepEqual(
      callsTo("apt-get").filter((call) => call.startsWith("apt-get install")),
      [],
    );
    assert.deepEqual(callsTo("useradd"), []);
    assert.equal(currentRelease(), "releases/1.2.0");
    const after = machine.read("/etc/the-office/office.env");
    assert.equal(passwordIn(after), passwordIn(before));
    assert.match(after, /^OFFICE_PUBLIC_ADDRESS=https:\/\/office\.example\.com$/m);
    assert.ok(!machine.readState("sql.log").includes("alter role"));
    const systemctl = callsTo("systemctl");
    assert.ok(!systemctl.includes("systemctl restart the-office"));
    assert.ok(!systemctl.includes("systemctl daemon-reload"));
    assert.ok(systemctl.includes("systemctl start the-office"));
    assert.match(printed, /^Setup token: token-2$/m);
  });

  it("prints no token once the first user exists, and says to sign in", () => {
    machine.setFlag("first-user");
    const printed = installed();
    assert.doesNotMatch(printed, /Setup token/);
    assert.match(printed, /already has its first user: sign in/);
    assert.ok(
      printed.includes(
        "  sudo systemd-run --quiet --pty --wait --collect --uid=the-office --gid=the-office -p EnvironmentFile=/etc/the-office/office.env --working-directory=/opt/the-office/current /usr/bin/npm run set-password -- --email <email>\n",
      ),
    );
    assert.match(
      printed,
      /^Guide: https:\/\/github\.com\/przemczan\/the-office\/blob\/main\/docs\/installing\.md$/m,
    );
  });

  it("installs and switches to a newer --version, and restarts", () => {
    machine.publishRelease("1.3.0");
    installed(["--version", "1.3.0"]);
    assert.equal(currentRelease(), "releases/1.3.0");
    assert.ok(callsTo("systemctl").includes("systemctl restart the-office"));
  });

  it("refuses an older --version", () => {
    machine.publishRelease("1.1.0");
    assert.match(refused(["--version", "1.1.0"]), /doesn't go back to the older 1\.1\.0/);
    assert.equal(currentRelease(), "releases/1.2.0");
  });

  it("makes a new password when office.env lost its DATABASE_URL", () => {
    const before = passwordIn(machine.read("/etc/the-office/office.env"));
    const envFile = machine.read("/etc/the-office/office.env").replace(DATABASE_URL, "");
    writeFileSync(machine.path("/etc/the-office/office.env"), envFile);
    installed();
    assert.match(
      machine.readState("sql.log"),
      /^alter role office with login password '[A-Za-z0-9]{32}';$/m,
    );
    assert.notEqual(passwordIn(machine.read("/etc/the-office/office.env")), before);
    assert.ok(callsTo("systemctl").includes("systemctl restart the-office"));
  });

  it("refuses to move the data folder", () => {
    assert.match(
      refused(["--data-dir", "/srv/elsewhere"]),
      /data folder is \/var\/lib\/the-office and can't be changed/,
    );
  });
});

/** Fails unless the install is all still there and nothing was removed. */
function assertStillInstalled(): void {
  assert.ok(existsSync(machine.path("/etc/systemd/system/the-office.service")));
  assert.ok(existsSync(machine.path("/opt/the-office/current")));
  assert.ok(existsSync(machine.path("/var/log/the-office-install.log")));
  assert.ok(!callsTo("systemctl").some((call) => call.startsWith("systemctl disable")));
  assert.deepEqual(
    callsTo("docker").filter((call) => call.includes(" rm")),
    [],
  );
}

describe("an uninstall", () => {
  beforeEach(() => {
    machine = freshMachine();
    installed();
    machine.clearCalls();
  });
  afterEach(() => machine.remove());

  it("removes the service, its unit, /opt/the-office and the install log, and keeps the data, office.env and the user", () => {
    const printed = installed(["--uninstall", "--yes"]);

    assert.ok(callsTo("systemctl").includes("systemctl disable --now the-office"));
    assert.ok(callsTo("systemctl").includes("systemctl daemon-reload"));
    assert.equal(existsSync(machine.path("/etc/systemd/system/the-office.service")), false);
    assert.equal(existsSync(machine.path("/opt/the-office")), false);
    assert.equal(existsSync(machine.path("/var/log/the-office-install.log")), false);
    assert.ok(existsSync(machine.path("/var/lib/the-office")));
    assert.ok(existsSync(machine.path("/etc/the-office/office.env")));
    assert.equal(machine.readState("users").trim(), "the-office");
    assert.doesNotMatch(machine.readState("sql.log"), /drop/);
    assert.deepEqual(callsTo("userdel"), []);
    assert.match(printed, /^Kept:\n {4}the data folder \/var\/lib\/the-office$/m);
    assert.match(
      printed,
      /^Node, Docker and PostgreSQL stay installed; to remove them too, see https:\/\/github\.com\/przemczan\/the-office\/blob\/main\/docs\/installing\.md#uninstalling$/m,
    );
    assert.match(printed, /\| sudo bash -s -- --uninstall --purge$/m);
  });

  it("removes the run environments' containers, networks, volumes and images by this Office's labels", () => {
    installed(["--uninstall", "--yes"]);
    const docker = callsTo("docker");
    const instance = createHash("sha256").update("/var/lib/the-office").digest("hex").slice(0, 12);
    for (const listing of [
      "docker ps -aq",
      "docker network ls -q",
      "docker volume ls -q",
      "docker image ls -q",
    ]) {
      assert.ok(
        docker.includes(
          `${listing} --filter label=office.managed=true --filter label=office.instance=${instance}`,
        ),
        listing,
      );
    }
    assert.ok(docker.includes("docker rm -f container-1 container-2"));
    assert.ok(docker.includes("docker network rm network-1"));
    assert.ok(docker.includes("docker volume rm -f volume-1"));
    assert.ok(docker.includes("docker image rm -f image-1"));
  });

  it("keeps Docker's leftovers, saying so, when Docker doesn't answer", () => {
    machine.setFlag("docker-info-fails");
    const printed = installed(["--uninstall", "--yes"]);
    assert.deepEqual(
      callsTo("docker").filter((call) => call.includes(" rm")),
      [],
    );
    assert.match(printed, /Docker isn't reachable/);
  });

  it("with --purge, also drops the database and its role and removes the data folder, /etc/the-office and the user", () => {
    const printed = installed(["--uninstall", "--purge", "--yes"]);

    const sql = machine.readState("sql.log");
    assert.match(sql, /^drop database if exists the_office with \(force\);$/m);
    assert.match(sql, /^drop role if exists office;$/m);
    assert.equal(existsSync(machine.path("/var/lib/the-office")), false);
    assert.equal(existsSync(machine.path("/etc/the-office")), false);
    assert.equal(existsSync(machine.path("/opt/the-office")), false);
    assert.deepEqual(callsTo("userdel"), ["userdel --remove the-office"]);
    assert.equal(machine.readState("users").trim(), "");
    assert.match(printed, /^ {4}the data folder \/var\/lib\/the-office$/m);
    assert.match(printed, /^The Office is uninstalled, its data with it\.$/m);
  });

  it("with --purge, keeps a data folder that isn't safe to remove", () => {
    appendFileSync(machine.path("/etc/the-office/office.env"), "OFFICE_DATA_DIR=/srv\n");
    mkdirSync(machine.path("/srv"));
    writeFileSync(machine.path("/srv/keep.txt"), "");
    const printed = installed(["--uninstall", "--purge", "--yes"]);
    assert.ok(existsSync(machine.path("/srv/keep.txt")));
    assert.match(
      printed,
      /Kept the data folder \/srv: it is a top-level folder; remove it by hand if you mean to\./,
    );
  });

  it("with --purge, keeps a data folder that belongs to someone else", () => {
    machine.setState("owners", `${machine.path("/var/lib/the-office")} alice\n`);
    const printed = installed(["--uninstall", "--purge", "--yes"]);
    assert.ok(existsSync(machine.path("/var/lib/the-office")));
    assert.match(
      printed,
      /Kept the data folder \/var\/lib\/the-office: it belongs to alice, not the-office; remove it by hand if you mean to\./,
    );
  });

  it("refuses without a terminal to confirm on and without --yes, changing nothing", () => {
    assert.match(
      refused(["--uninstall"]),
      /There is no terminal to confirm on; run it again with --yes to uninstall\./,
    );
    assertStillInstalled();
  });

  it("stops when the user doesn't confirm, changing nothing", () => {
    mkdirSync(machine.path("/dev"));
    writeFileSync(machine.path("/dev/tty"), "\n");
    assert.match(refused(["--uninstall", "--purge"]), /Stopped; nothing was removed\./);
    assertStillInstalled();
    assert.ok(existsSync(machine.path("/var/lib/the-office")));
  });

  it("refuses --purge without --uninstall, and an install option beside --uninstall", () => {
    assert.match(refused(["--purge"]), /--purge goes with --uninstall\./);
    assert.match(
      refused(["--uninstall", "--port", "4400"]),
      /--uninstall takes only --purge and --yes, not --port\./,
    );
    assertStillInstalled();
  });
});

describe("an uninstall where nothing is installed", () => {
  beforeEach(() => (machine = freshMachine()));
  afterEach(() => machine.remove());

  it("says so and succeeds, changing nothing", () => {
    const printed = installed(["--uninstall", "--purge", "--yes"]);
    assert.match(printed, /^The Office isn't installed here; nothing to remove\.$/m);
    assertNothingChanged();
    assert.deepEqual(callsTo("systemctl"), []);
  });
});

describe("refusals before anything changes", () => {
  afterEach(() => machine.remove());

  it("refuses a user other than root, giving the sudo one-liner", () => {
    machine = freshMachine();
    machine.setState("uid", "1000");
    assert.match(
      refused(),
      /curl -fsSL https:\/\/github\.com\/przemczan\/the-office\/releases\/latest\/download\/install\.sh \| sudo bash/,
    );
    assertNothingChanged();
  });

  it("refuses a machine without systemd", () => {
    machine = freshMachine();
    rmSync(machine.path("/run/systemd"), { recursive: true });
    assert.match(refused(), /doesn't run systemd/);
    assertNothingChanged();
  });

  it("refuses an unsupported system", () => {
    machine = freshMachine({ id: "ubuntu", versionId: "20.04", codename: "focal" });
    assert.match(refused(), /ubuntu 20\.04 \(focal\) isn't supported/);
    assertNothingChanged();
  });

  it("refuses an unsupported arch", () => {
    machine = freshMachine();
    machine.setState("arch", "armhf");
    assert.match(refused(), /The armhf architecture isn't supported/);
    assertNothingChanged();
  });
});

describe("Docker", () => {
  beforeEach(
    () => (machine = freshMachine({ id: "ubuntu", versionId: "24.04", codename: "noble" })),
  );
  afterEach(() => machine.remove());

  it("keeps a Docker that has Compose and buildx", () => {
    machine.installDocker();
    installed();
    assert.ok(!callsTo("apt-get").some((call) => call.includes("docker-ce")));
    assert.deepEqual(callsTo("apt-mark"), []);
  });

  it("stops at a Docker that lacks Compose, saying so", () => {
    machine.installDocker();
    machine.setFlag("docker-lacks-compose");
    assert.match(refused(), /Docker is installed but lacks Docker Compose \(docker compose\)/);
  });

  it("warns about nesting in an LXC guest, and stops with the fix when Docker can't start", () => {
    machine.setState("virt", "lxc");
    machine.setFlag("docker-info-fails");
    const result = machine.install();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Warning: this is an LXC guest/);
    assert.match(result.stderr, /pct set <id> --features nesting=1,keyctl=1/);
    assert.ok(
      callsTo("apt-get").some((call) => call.includes("docker-ce=5:29.9.3-1~ubuntu.24.04~noble")),
    );
  });
});
