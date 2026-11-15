import { describe, expect, it } from "vitest";
import {
  composeProjectFrom,
  containerIdFrom,
  hostPathOf,
  officeContainerFrom,
  updaterRunArguments,
} from "./docker-cli-office-container.js";

const ID = "4f2a6c0e9b1d3a5f7e8c0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a";

// As `docker inspect` gives a container Docker Compose started, trimmed to what is read.
const INSPECTED = [
  {
    Id: ID,
    Image: "sha256:5e3f0c1d2b4a6978",
    Config: {
      Image: "ghcr.io/owner/the-office:1.3.0",
      Labels: {
        "com.docker.compose.project": "the-office",
        "com.docker.compose.service": "office",
        "com.docker.compose.project.working_dir": "/srv/the-office",
        "com.docker.compose.project.config_files": "/srv/the-office/docker-compose.yml",
        "com.docker.compose.project.environment_file": "/srv/the-office/.env",
        "org.opencontainers.image.version": "1.3.0",
      },
    },
    Mounts: [
      { Type: "bind", Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock" },
      { Type: "bind", Source: "/srv/office-data", Destination: "/var/lib/the-office" },
    ],
  },
];

describe("The Office's own container", () => {
  it("finds its id where Docker mounts the container's own files", () => {
    const mountinfo = [
      "612 590 0:52 / / rw,relatime master:301 - overlay overlay rw",
      `633 612 8:1 /var/lib/docker/containers/${ID}/resolv.conf /etc/resolv.conf rw,relatime - ext4 /dev/sda1 rw`,
      `634 612 8:1 /var/lib/docker/containers/${ID}/hostname /etc/hostname rw,relatime - ext4 /dev/sda1 rw`,
    ].join("\n");

    expect(containerIdFrom(mountinfo)).toBe(ID);
    expect(containerIdFrom("25 1 8:1 / / rw - ext4 /dev/sda1 rw\n")).toBeUndefined();
  });

  it("reads its image, mounts and the Compose project from the labels Compose sets", () => {
    expect(officeContainerFrom(INSPECTED)).toEqual({
      id: ID,
      image: "ghcr.io/owner/the-office:1.3.0",
      imageId: "sha256:5e3f0c1d2b4a6978",
      compose: {
        project: "the-office",
        service: "office",
        workingDirectory: "/srv/the-office",
        configFiles: ["/srv/the-office/docker-compose.yml"],
        environmentFiles: ["/srv/the-office/.env"],
      },
      mounts: [
        { source: "/var/run/docker.sock", destination: "/var/run/docker.sock" },
        { source: "/srv/office-data", destination: "/var/lib/the-office" },
      ],
    });
  });

  it("has no Compose project when Compose's labels are missing", () => {
    expect(composeProjectFrom({ "com.docker.compose.project": "the-office" })).toBeUndefined();
    const [container] = INSPECTED;
    const plain = [{ ...container, Config: { ...container?.Config, Labels: null } }];
    expect(officeContainerFrom(plain).compose).toBeUndefined();
  });

  it("finds a folder's path on the host through the mount holding it", () => {
    const { mounts } = officeContainerFrom(INSPECTED);

    expect(hostPathOf(mounts, "/var/lib/the-office/update")).toBe("/srv/office-data/update");
    expect(hostPathOf(mounts, "/opt/the-office")).toBeUndefined();
  });

  it("runs the Office updater from the same image, with Docker, the compose folder and the data mounted", () => {
    const container = officeContainerFrom(INSPECTED);
    if (!container.compose) throw new Error("Compose started it.");

    expect(
      updaterRunArguments(container, container.compose, {
        updateFolder: "/var/lib/the-office/update",
        officeDataDirectory: "/var/lib/the-office",
      }),
    ).toEqual([
      "run",
      "--detach",
      "--rm",
      "--label",
      "org.the-office.updater=1",
      "--user",
      "0:0",
      "--volume",
      "/var/run/docker.sock:/var/run/docker.sock",
      "--volume",
      "/srv/the-office:/srv/the-office",
      "--volume",
      "/srv/office-data:/var/lib/the-office",
      "--env",
      "OFFICE_UPDATE_FOLDER=/var/lib/the-office/update",
      "--env",
      `OFFICE_CONTAINER=${ID}`,
      "--entrypoint",
      "node",
      "sha256:5e3f0c1d2b4a6978",
      "/opt/the-office/tools/office-launcher/src/container-main.ts",
    ]);
  });
});
