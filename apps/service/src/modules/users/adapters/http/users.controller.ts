import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseFilters } from "@nestjs/common";
import {
  newUserSchema,
  type AddedUser,
  type NewUser,
  type OneTimePassword,
  type User as UserMessage,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn } from "../../../../platform/http/signed-in-requests.js";
import { Users } from "../../application/users.js";
import type { User } from "../../domain/user.js";
import { UserRefusalsFilter } from "./user-refusals.filter.js";

/** Settings › Users (spec §2.10): the users, adding one with a one-time password, removing one. */
@Controller("users")
@UseFilters(UserRefusalsFilter)
export class UsersController {
  constructor(private readonly users: Users) {}

  @Get()
  async list(@SignedIn() { userId }: SignedIn): Promise<UserMessage[]> {
    const users = await this.users.list();
    return users.map((user) => userMessageOf(user, userId));
  }

  /** The one-time password is in this answer only; it is kept nowhere but as its hash. */
  @Post()
  async add(
    @SignedIn() { userId }: SignedIn,
    @Body(new ContractPipe(newUserSchema)) newUser: NewUser,
  ): Promise<AddedUser> {
    const { user, oneTimePassword } = await this.users.add(newUser);
    return { user: userMessageOf(user, userId), oneTimePassword };
  }

  @Post(":userId/one-time-password")
  @HttpCode(200)
  async newOneTimePassword(@Param("userId") userId: string): Promise<OneTimePassword> {
    return { oneTimePassword: await this.users.newOneTimePassword(userId) };
  }

  @Delete(":userId")
  @HttpCode(204)
  async remove(@SignedIn() signedIn: SignedIn, @Param("userId") userId: string): Promise<void> {
    await this.users.remove(userId, signedIn.userId);
  }
}

function userMessageOf(user: User, signedInUserId: string): UserMessage {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    you: user.id === signedInUserId,
    oneTimePasswordExpiresAt: user.oneTimePasswordExpiresAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
