import { Injectable } from "@nestjs/common";
import {
  messageImageProblem,
  messageImagesProblem,
  SKILL_COMMAND_IMAGES_PROBLEM,
} from "@the-office/contracts";
import { MessageImageRules } from "../../ports/message-image-rules.js";

/** The contracts' rules of a message's images, which the web's message box checks too. */
@Injectable()
export class ContractMessageImageRules extends MessageImageRules {
  readonly skillCommandProblem = SKILL_COMMAND_IMAGES_PROBLEM;

  imageProblem(image: {
    readonly name: string;
    readonly mediaType: string;
    readonly size: number;
  }): string | null {
    return messageImageProblem(image);
  }

  imagesProblem(images: readonly { readonly size: number }[]): string | null {
    return messageImagesProblem(images);
  }
}
