import { Readable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { AvatarNotFound } from "../domain/avatar.js";
import type { Role } from "../domain/role.js";
import { aRole } from "../domain/role.fixtures.js";
import type { RoleChange } from "../domain/role-changes.js";
import { RoleAvatarChanged } from "../domain/role-events.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { RoleRefused } from "../domain/role-refused.js";
import { AvatarFiles } from "../ports/avatar-files.js";
import type { RoleRepository, RoleUpdate } from "../ports/role-repository.js";
import { PersonAvatars } from "./person-avatars.js";

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const SVG = new TextEncoder().encode("<svg/>");

class FilesInMemory extends AvatarFiles {
  readonly files = new Map<string, Uint8Array>();

  async save(imageId: string, content: Uint8Array): Promise<void> {
    this.files.set(imageId, content);
  }

  async open(imageId: string): Promise<Readable> {
    const content = this.files.get(imageId);
    if (!content) throw new Error("No such file.");
    return Readable.from([content]);
  }

  async remove(imageId: string): Promise<void> {
    this.files.delete(imageId);
  }
}

/** Only what Avatars use of the repository. */
class RolesInMemory {
  failingUpdates = false;

  constructor(public stored: Role) {}

  async find(key: string): Promise<Role | undefined> {
    return key === this.stored.key ? this.stored : undefined;
  }

  async changeAvatar(
    key: string,
    change: (role: Role) => RoleChange<RoleAvatarChanged> | undefined,
  ): Promise<RoleUpdate<RoleAvatarChanged>> {
    if (this.failingUpdates) throw new Error("The database is away.");
    if (key !== this.stored.key) throw new RoleNotFound(key);
    const changed = change(this.stored);
    if (!changed) return { role: this.stored, event: undefined };
    this.stored = changed.role;
    return changed;
  }
}

let files: FilesInMemory;
let roles: RolesInMemory;
let published: DomainEvent[];
let avatars: PersonAvatars;

beforeEach(() => {
  files = new FilesInMemory();
  roles = new RolesInMemory(aRole());
  published = [];
  const events = new EventBus();
  events.subscribeToEveryEvent((event) => void published.push(event));
  avatars = new PersonAvatars(roles as unknown as RoleRepository, files, events);
});

function storedFiles(): string[] {
  return [...files.files.keys()];
}

describe("changing an Avatar", () => {
  it("keeps the file under its id, with the type read from its bytes", async () => {
    await avatars.change("developer", SVG);

    expect(roles.stored.avatar?.mediaType).toBe("image/svg+xml");
    expect(storedFiles()).toEqual([roles.stored.avatar?.id]);
  });

  it("announces the change once it is kept", async () => {
    await avatars.change("developer", PNG);

    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(RoleAvatarChanged);
  });

  it("removes the replaced file, under a new id for the new one", async () => {
    await avatars.change("developer", PNG);
    const first = roles.stored.avatar;

    await avatars.change("developer", SVG);

    expect(roles.stored.avatar?.id).not.toBe(first?.id);
    expect(storedFiles()).toEqual([roles.stored.avatar?.id]);
  });

  it("refuses what isn't an image, keeping the Avatar and writing nothing", async () => {
    await avatars.change("developer", PNG);
    const { avatar } = roles.stored;
    published = [];

    await expect(
      avatars.change("developer", new TextEncoder().encode("not an image")),
    ).rejects.toThrow(RoleRefused);

    expect(roles.stored.avatar).toEqual(avatar);
    expect(storedFiles()).toEqual([avatar?.id]);
    expect(published).toEqual([]);
  });

  it("leaves no new file when the update fails, and keeps the old one", async () => {
    await avatars.change("developer", PNG);
    const { avatar } = roles.stored;
    roles.failingUpdates = true;

    await expect(avatars.change("developer", SVG)).rejects.toThrow("away");

    expect(storedFiles()).toEqual([avatar?.id]);
  });

  it("leaves no file for someone let go, whose Avatar stays", async () => {
    await avatars.change("developer", PNG);
    const { avatar } = roles.stored;
    roles.stored = { ...roles.stored, letGoAt: new Date() };

    await expect(avatars.change("developer", SVG)).rejects.toThrow(RoleRefused);

    expect(storedFiles()).toEqual([avatar?.id]);
  });

  it("leaves no file for a Role that isn't there", async () => {
    await expect(avatars.change("nobody", PNG)).rejects.toThrow(RoleNotFound);

    expect(files.files.size).toBe(0);
  });

  it("keeps the change when the replaced file can't be removed", async () => {
    await avatars.change("developer", PNG);
    const remove = files.remove.bind(files);
    files.remove = async () => {
      files.remove = remove;
      throw new Error("The disk is busy.");
    };

    await avatars.change("developer", SVG);

    expect(roles.stored.avatar?.mediaType).toBe("image/svg+xml");
  });
});

describe("removing an Avatar", () => {
  it("clears it and removes its file", async () => {
    await avatars.change("developer", PNG);
    published = [];

    await avatars.remove("developer");

    expect(roles.stored.avatar).toBeNull();
    expect(files.files.size).toBe(0);
    expect(published[0]).toBeInstanceOf(RoleAvatarChanged);
  });

  it("changes nothing when the person has none", async () => {
    await avatars.remove("developer");

    expect(published).toEqual([]);
  });

  it("refuses for someone let go, keeping the file", async () => {
    await avatars.change("developer", PNG);
    roles.stored = { ...roles.stored, letGoAt: new Date() };

    await expect(avatars.remove("developer")).rejects.toThrow(RoleRefused);

    expect(files.files.size).toBe(1);
  });
});

describe("opening an Avatar", () => {
  it("opens the one the person holds", async () => {
    await avatars.change("developer", PNG);
    const { avatar } = roles.stored;

    const opened = await avatars.open("developer", avatar?.id ?? "");

    expect(opened.avatar).toEqual(avatar);
  });

  it("answers for none the person no longer holds", async () => {
    await avatars.change("developer", PNG);
    const { avatar } = roles.stored;
    await avatars.remove("developer");

    await expect(avatars.open("developer", avatar?.id ?? "")).rejects.toThrow(AvatarNotFound);
  });

  it("answers for no Role that isn't there", async () => {
    await expect(avatars.open("nobody", "an-id")).rejects.toThrow(RoleNotFound);
  });
});
