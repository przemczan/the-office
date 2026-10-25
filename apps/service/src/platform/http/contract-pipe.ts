import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

/**
 * Parses a request's body or parameter with its contract schema, answering 400 with what is wrong
 * when it doesn't match, so a controller only ever sees the contract's type.
 */
export class ContractPipe<Schema extends z.ZodType> implements PipeTransform<
  unknown,
  z.infer<Schema>
> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.infer<Schema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new BadRequestException(
      result.error.issues
        .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ` : "") + issue.message)
        .join("; "),
    );
  }
}
