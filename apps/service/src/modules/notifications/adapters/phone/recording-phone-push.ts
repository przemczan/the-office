import { Injectable, Logger } from "@nestjs/common";
import type { Notification } from "../../domain/notification.js";
import { PhonePush } from "../../ports/phone-push.js";

/** As many pushes as are kept, the latest: enough to look at, never growing without end. */
const KEPT_PUSHES = 100;

/**
 * The phone until task 28 brings Web Push: records each push it would send, and logs it, so the
 * delivery rules can be watched and tested without a phone.
 */
@Injectable()
export class RecordingPhonePush extends PhonePush {
  private readonly logger = new Logger(PhonePush.name);
  private readonly kept: { readonly userId: string; readonly notification: Notification }[] = [];

  push(userId: string, notification: Notification): Promise<void> {
    this.kept.push({ userId, notification });
    if (this.kept.length > KEPT_PUSHES) this.kept.shift();
    this.logger.log(`To ${userId}'s phone: ${notification.line}`);
    return Promise.resolve();
  }

  /** The pushes recorded to every user's phone, oldest first. */
  get pushed(): readonly Notification[] {
    return this.kept.map(({ notification }) => notification);
  }

  /** The pushes recorded to one user's phone, oldest first. */
  pushedTo(userId: string): readonly Notification[] {
    return this.kept
      .filter((push) => push.userId === userId)
      .map(({ notification }) => notification);
  }
}
