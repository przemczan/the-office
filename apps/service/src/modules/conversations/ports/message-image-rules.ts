/**
 * The rules of the images a message carries, in the words the user reads: the same the message box
 * checks before it sends, so the service and the web never word them apart.
 */
export abstract class MessageImageRules {
  /** The rule one image breaks; null when it keeps them all. */
  abstract imageProblem(image: {
    readonly name: string;
    readonly mediaType: string;
    readonly size: number;
  }): string | null;

  /** The rule a message's images break together; null when they keep them. */
  abstract imagesProblem(images: readonly { readonly size: number }[]): string | null;

  /** Why a skill command carries no images. */
  abstract readonly skillCommandProblem: string;
}
