import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { callFunction, withScript } from "./install-script.fixtures.ts";

function output(name: string, ...args: string[]): string {
  const result = callFunction(name, args);
  assert.equal(result.status, 0, `${name} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trimEnd();
}

function succeeds(name: string, ...args: string[]): boolean {
  return callFunction(name, args).status === 0;
}

const folder = mkdtempSync(join(tmpdir(), "office-install-functions-"));
after(() => rmSync(folder, { recursive: true, force: true }));

function envFile(text: string): string {
  const path = join(folder, `office-${Math.random().toString(36).slice(2)}.env`);
  writeFileSync(path, text);
  return path;
}

describe("the system", () => {
  it("names the tarball's arch from dpkg's, and refuses the rest", () => {
    assert.equal(output("arch_of", "amd64"), "x64");
    assert.equal(output("arch_of", "arm64"), "arm64");
    assert.equal(succeeds("arch_of", "i386"), false);
    assert.equal(succeeds("arch_of", "armhf"), false);
  });

  it("supports Debian 12 and 13 and Ubuntu 22.04 and 24.04 alone", () => {
    for (const [id, codename] of [
      ["debian", "bookworm"],
      ["debian", "trixie"],
      ["ubuntu", "jammy"],
      ["ubuntu", "noble"],
    ] as const) {
      assert.equal(succeeds("supported_codename", id, codename), true, `${id} ${codename}`);
    }
    for (const [id, codename] of [
      ["debian", "bullseye"],
      ["ubuntu", "focal"],
      ["ubuntu", "trixie"],
      ["fedora", "noble"],
    ] as const) {
      assert.equal(succeeds("supported_codename", id, codename), false, `${id} ${codename}`);
    }
  });

  it("takes Node 22.18 or later below 23", () => {
    assert.equal(succeeds("node_version_fits", "v22.18.0"), true);
    assert.equal(succeeds("node_version_fits", "v22.23.4"), true);
    assert.equal(succeeds("node_version_fits", "v22.17.1"), false);
    assert.equal(succeeds("node_version_fits", "v23.0.0"), false);
    assert.equal(succeeds("node_version_fits", "v20.19.0"), false);
    assert.equal(succeeds("node_version_fits", ""), false);
  });
});

describe("versions and assets", () => {
  it("reads a version with or without its v, and refuses anything else", () => {
    assert.equal(output("parse_version", "v1.2.3"), "1.2.3");
    assert.equal(output("parse_version", "10.0.12"), "10.0.12");
    assert.equal(output("parse_version", "0.0.0-dry-run.abc1234"), "0.0.0-dry-run.abc1234");
    for (const wrong of ["1.2", "01.2.3", "latest", "1.2.3 ", "v", ""]) {
      assert.equal(succeeds("parse_version", wrong), false, wrong);
    }
  });

  it("orders versions, a pre-release before its release", () => {
    assert.equal(output("compare_versions", "1.2.3", "1.2.3"), "0");
    assert.equal(output("compare_versions", "1.10.0", "1.9.9"), "1");
    assert.equal(output("compare_versions", "1.9.9", "1.10.0"), "-1");
    assert.equal(output("compare_versions", "2.0.0", "1.99.99"), "1");
    assert.equal(output("compare_versions", "1.0.0-rc.1", "1.0.0"), "-1");
    assert.equal(output("compare_versions", "1.0.0", "1.0.0-rc.1"), "1");
  });

  it("names the tarball and its address on GitHub Releases", () => {
    assert.equal(output("tarball_name", "1.2.3", "arm64"), "the-office-1.2.3-linux-arm64.tar.gz");
    assert.equal(
      output("asset_url", "przemczan/the-office", "1.2.3", "the-office-1.2.3-linux-x64.tar.gz"),
      "https://github.com/przemczan/the-office/releases/download/v1.2.3/the-office-1.2.3-linux-x64.tar.gz",
    );
  });

  it("builds Docker's apt version for each supported system", () => {
    const expected = {
      "debian 12 bookworm": "5:29.9.3-1~debian.12~bookworm",
      "debian 13 trixie": "5:29.9.3-1~debian.13~trixie",
      "ubuntu 22.04 jammy": "5:29.9.3-1~ubuntu.22.04~jammy",
      "ubuntu 24.04 noble": "5:29.9.3-1~ubuntu.24.04~noble",
    };
    for (const [system, version] of Object.entries(expected)) {
      assert.equal(output("docker_package_version", "5:29.9.3-1", ...system.split(" ")), version);
    }
  });

  it("holds the Docker versions docs/container-runtime.md holds", () => {
    const versions = withScript(
      'echo "$DOCKER_ENGINE_VERSION $CONTAINERD_VERSION $DOCKER_BUILDX_VERSION $DOCKER_COMPOSE_VERSION"',
    );
    assert.equal(versions.stdout.trim(), "5:29.9.3-1 2.4.2-3 0.38.1-1 5.7.0-1");
  });
});

describe("the answers", () => {
  it("takes an IPv4 or IPv6 address as the host", () => {
    for (const host of [
      "127.0.0.1",
      "0.0.0.0",
      "192.168.1.20",
      "::",
      "::1",
      "fd00::20",
      "2001:db8:0:0:0:0:0:1",
    ]) {
      assert.equal(succeeds("valid_host", host), true, host);
    }
    for (const host of [
      "localhost",
      "256.1.1.1",
      "1.2.3",
      "01.2.3.4",
      "1::2::3",
      "12345::1",
      "1:2:3:4:5:6:7",
      "",
    ]) {
      assert.equal(succeeds("valid_host", host), false, host);
    }
  });

  it("takes a port from 1024 to 65535", () => {
    for (const port of ["1024", "4310", "65535"])
      assert.equal(succeeds("valid_port", port), true, port);
    for (const port of ["80", "1023", "65536", "04310", "43a", ""]) {
      assert.equal(succeeds("valid_port", port), false, port);
    }
  });

  it("takes an absolute data folder written as a plain word", () => {
    for (const dir of ["/var/lib/the-office", "/srv/office_data/", "/data"]) {
      assert.equal(succeeds("valid_data_dir", dir), true, dir);
    }
    for (const dir of ["relative/path", "/", "/with space", "/a/../b", "/a/./b", '/q"uote', ""]) {
      assert.equal(succeeds("valid_data_dir", dir), false, dir);
    }
  });

  it("resolves each answer from the flags, else the environment, else office.env, else the defaults", () => {
    const file = envFile("OFFICE_HOST=0.0.0.0\nOFFICE_PORT=4400\nOFFICE_DATA_DIR=/srv/office\n");
    const resolved = (script: string): string =>
      withScript(
        `${script}; resolve_answers "$1"; echo "$HOST/$HOST_SOURCE $PORT/$PORT_SOURCE $DATA_DIR/$DATA_DIR_SOURCE"`,
        [file],
      ).stdout.trim();
    assert.equal(resolved(":"), "0.0.0.0/existing 4400/existing /srv/office/existing");
    assert.equal(
      resolved("OFFICE_PORT=4500; FLAG_HOST=192.168.1.20"),
      "192.168.1.20/flag 4500/environment /srv/office/existing",
    );
    assert.equal(
      resolved("FLAG_PORT=4600; OFFICE_PORT=4500"),
      "0.0.0.0/existing 4600/flag /srv/office/existing",
    );
    const none = withScript(
      'resolve_answers "$1"; echo "$HOST/$HOST_SOURCE $PORT/$PORT_SOURCE $DATA_DIR/$DATA_DIR_SOURCE"',
      [join(folder, "missing.env")],
    );
    assert.equal(none.stdout.trim(), "127.0.0.1/default 4310/default /var/lib/the-office/default");
  });
});

describe("office.env", () => {
  it("reads a key's last value, unquoted, and nothing for a key or file it lacks", () => {
    const file = envFile('ID=debian\nVERSION_ID="13"\nOFFICE_PORT=4310\nOFFICE_PORT=4400\n');
    assert.equal(output("env_value", file, "VERSION_ID"), "13");
    assert.equal(output("env_value", file, "OFFICE_PORT"), "4400");
    assert.equal(output("env_value", file, "OFFICE_HOST"), "");
    assert.equal(output("env_value", join(folder, "missing.env"), "OFFICE_HOST"), "");
  });

  it("sets one key, keeping every other line where it is", () => {
    const file = envFile(
      "# The Office\nOFFICE_HOST=127.0.0.1\nOFFICE_PUBLIC_ADDRESS=https://office.example.com\nOFFICE_PORT=4310\n",
    );
    assert.equal(
      output("env_with", file, "OFFICE_HOST", "0.0.0.0"),
      "# The Office\nOFFICE_HOST=0.0.0.0\nOFFICE_PUBLIC_ADDRESS=https://office.example.com\nOFFICE_PORT=4310",
    );
    assert.equal(
      output("env_with", file, "DATABASE_URL", "postgres://office:x@127.0.0.1:5432/the_office"),
      "# The Office\nOFFICE_HOST=127.0.0.1\nOFFICE_PUBLIC_ADDRESS=https://office.example.com\nOFFICE_PORT=4310\nDATABASE_URL=postgres://office:x@127.0.0.1:5432/the_office",
    );
    assert.equal(
      output("env_with", join(folder, "missing.env"), "OFFICE_PORT", "4310"),
      "OFFICE_PORT=4310",
    );
  });
});

describe("addresses", () => {
  it("asks for health on this machine", () => {
    assert.equal(output("health_url", "127.0.0.1", "4310"), "http://127.0.0.1:4310/api/health");
    assert.equal(output("health_url", "0.0.0.0", "4310"), "http://127.0.0.1:4310/api/health");
    assert.equal(output("health_url", "::", "4310"), "http://[::1]:4310/api/health");
    assert.equal(
      output("health_url", "192.168.1.20", "4400"),
      "http://192.168.1.20:4400/api/health",
    );
  });

  it("gives the address to open, the machine's own when The Office listens on every address", () => {
    const ips = "192.168.1.20 fd00::20";
    assert.equal(output("open_address", "127.0.0.1", "4310", ips), "http://127.0.0.1:4310");
    assert.equal(output("open_address", "0.0.0.0", "4310", ips), "http://192.168.1.20:4310");
    assert.equal(output("open_address", "::", "4310", ips), "http://[fd00::20]:4310");
    assert.equal(output("open_address", "0.0.0.0", "4310", ""), "http://127.0.0.1:4310");
    assert.equal(output("open_address", "fd00::20", "4310", ips), "http://[fd00::20]:4310");
  });
});

describe("PostgreSQL", () => {
  it("finds the 18 cluster's port among the clusters", () => {
    const clusters = [
      "16 main 5432 online postgres /var/lib/postgresql/16/main /var/log/postgresql/postgresql-16-main.log",
      "18 main 5433 online postgres /var/lib/postgresql/18/main /var/log/postgresql/postgresql-18-main.log",
    ].join("\n");
    assert.equal(output("cluster_port", clusters), "5433");
    assert.equal(succeeds("cluster_port", clusters.split("\n")[0] ?? ""), false);
    assert.equal(succeeds("cluster_port", ""), false);
  });

  it("makes a 32-character alphanumeric password, a new one each time", () => {
    const first = output("random_password");
    assert.match(first, /^[A-Za-z0-9]{32}$/);
    assert.notEqual(output("random_password"), first);
  });
});

describe("the unit", () => {
  it("follows the shared install layout", () => {
    assert.equal(
      output("unit_text"),
      [
        "[Unit]",
        "Description=The Office",
        "After=network-online.target postgresql.service docker.service",
        "Wants=network-online.target postgresql.service docker.service",
        "",
        "[Service]",
        "User=the-office",
        "Group=the-office",
        "SupplementaryGroups=docker",
        "WorkingDirectory=/opt/the-office",
        "EnvironmentFile=/etc/the-office/office.env",
        "Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "ExecStart=/usr/bin/node /opt/the-office/current/tools/office-launcher/src/main.ts",
        "Restart=always",
        "RestartSec=5",
        "KillMode=mixed",
        "TimeoutStopSec=15min",
        "",
        "[Install]",
        "WantedBy=multi-user.target",
      ].join("\n"),
    );
  });
});

describe("the stamp", () => {
  it("keeps its two placeholders, which tools/release/prepare.sh replaces, and no other", () => {
    const stamps = withScript('echo "$STAMPED_VERSION $STAMPED_REPOSITORY"');
    assert.equal(stamps.stdout.trim(), "@OFFICE_VERSION@ @OFFICE_REPOSITORY@");
  });
});
