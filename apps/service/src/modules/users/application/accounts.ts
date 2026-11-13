import { Injectable } from "@nestjs/common";
import type { User } from "../domain/user.js";
import { UserRepository } from "../ports/user-repository.js";

/** A user's own record (spec §2.10, the account). */
@Injectable()
export class Accounts {
  constructor(private readonly users: UserRepository) {}

  of(userId: string): Promise<User | undefined> {
    return this.users.find(userId);
  }
}
