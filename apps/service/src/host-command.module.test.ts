import { NestFactory } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { freshTestDatabase } from "../test/test-database.js";
import { HostCommandModule } from "./host-command.module.js";
import { Authenticators, FirstRunSetup, Passwords } from "./modules/users/index.js";

describe("HostCommandModule", () => {
  it("starts with everything the host commands use", async () => {
    const database = await freshTestDatabase();
    const app = await NestFactory.createApplicationContext(
      HostCommandModule.register(database.url),
      { logger: false },
    );
    try {
      expect(app.get(Passwords)).toBeInstanceOf(Passwords);
      expect(app.get(Authenticators)).toBeInstanceOf(Authenticators);
      expect(await app.get(FirstRunSetup).newToken()).toMatch(/^(\w{4}-){5}\w{4}$/);
    } finally {
      await app.close();
      await database.drop();
    }
  });
});
