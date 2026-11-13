import type { CodeAnswer, SignInRefusal } from "@the-office/contracts";
import { Alert, Input, TextButton } from "@the-office/ui";
import type { ReactNode } from "react";
import { RefusedAs } from "../api/api-client.ts";
import { useTryAgainWords } from "./try-again-words.ts";
import "./code-answer-field.css";

/** What the user types to prove they hold their authenticator: its code, or a recovery code. */
export interface CodeAnswerDraft {
  readonly kind: "code" | "recoveryCode";
  readonly value: string;
}

export const NO_CODE_ANSWER: CodeAnswerDraft = { kind: "code", value: "" };

/** The draft as the service takes it. */
export function codeAnswerOf({ kind, value }: CodeAnswerDraft): CodeAnswer {
  return kind === "code" ? { code: value.trim() } : { recoveryCode: value.trim() };
}

/**
 * The authenticator code's field (spec §2.10), numeric and filled in by the phone's keyboard where
 * it can, with "Use a recovery code" to type one of those instead, when one is taken.
 */
export function CodeAnswerField({
  draft,
  onChange,
  recoveryCodeTaken = true,
  autoFocus = false,
}: {
  readonly draft: CodeAnswerDraft;
  readonly onChange: (draft: CodeAnswerDraft) => void;
  readonly recoveryCodeTaken?: boolean;
  readonly autoFocus?: boolean;
}): ReactNode {
  const typed = (value: string): void => onChange({ ...draft, value });
  return (
    <div className="code-answer-field">
      {draft.kind === "code" ? (
        <Input
          key="code"
          label="Authenticator code"
          hint="The 6 digits your authenticator app shows for The Office."
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          value={draft.value}
          onChange={(event) => typed(event.target.value.replaceAll(/\D/g, ""))}
          required
          autoFocus={autoFocus}
        />
      ) : (
        <Input
          key="recoveryCode"
          label="Recovery code"
          hint="One of the codes you saved when you set up the authenticator, such as 7KQ2M-XC9RT."
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={draft.value}
          onChange={(event) => typed(event.target.value)}
          required
          autoFocus
        />
      )}
      {recoveryCodeTaken && (
        <TextButton
          onClick={() =>
            onChange({ kind: draft.kind === "code" ? "recoveryCode" : "code", value: "" })
          }
        >
          {draft.kind === "code" ? "Use a recovery code" : "Use the authenticator code"}
        </TextButton>
      )}
    </div>
  );
}

/** A refused code in words: the service's, and when to try again once wrong tries cost a wait. */
export interface CodeRefusal {
  readonly message: string;
  readonly waitWords: string | undefined;
}

/** What a code's refusal says, renewed each second while a wait runs; undefined with none. */
export function useCodeRefusal(error: Error | null): CodeRefusal | undefined {
  const refusal = error instanceof RefusedAs ? (error.refusal as SignInRefusal) : undefined;
  const waitWords = useTryAgainWords(refusal?.tryAgainAt);
  if (error === null) return undefined;
  return { message: refusal?.message ?? error.message, waitWords };
}

export function CodeRefusalAlert({ refusal }: { readonly refusal: CodeRefusal }): ReactNode {
  return (
    <Alert tone="danger" title={refusal.message}>
      {refusal.waitWords}
    </Alert>
  );
}
