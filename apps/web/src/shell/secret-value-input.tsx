import { Button, Input } from "@the-office/ui";
import type { ReactNode } from "react";
import { SECRET_ON_SAVE_WORDS, secretOnSave } from "./secret-value.ts";

/**
 * A secret value's field, as Settings › Engines' key: the kept value is never shown, an empty
 * field keeps it, and only "Remove the value" removes it. `typed` is the value as saving takes it
 * (`secretOnSave`); `set` whether one is kept now.
 */
export function SecretValueInput({
  label,
  typed,
  set,
  change,
}: {
  readonly label: string;
  readonly typed: string | undefined;
  readonly set: boolean;
  readonly change: (typed: string | undefined) => void;
}): ReactNode {
  const onSave = secretOnSave(typed, set);
  return (
    <Input
      label={label}
      type="password"
      autoComplete="off"
      hint={SECRET_ON_SAVE_WORDS[onSave]}
      value={typed ?? ""}
      onChange={({ target: { value } }) => change(value || undefined)}
      suffix={
        onSave === "kept-set" ? (
          <Button variant="ghost" size="sm" onClick={() => change("")}>
            Remove the value
          </Button>
        ) : onSave === "removed" ? (
          <Button variant="ghost" size="sm" onClick={() => change(undefined)}>
            Keep the value
          </Button>
        ) : undefined
      }
    />
  );
}
