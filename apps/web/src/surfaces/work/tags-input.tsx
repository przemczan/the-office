import { Tag } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { withTag } from "./tag-words.ts";

/**
 * A Task's Tags as chips, each removable, and a box adding one on Enter or a comma, suggesting the
 * Tags in use; Backspace in the empty box removes the last.
 */
export function TagsInput({
  tags,
  suggestions,
  onChange,
  disabled = false,
}: {
  readonly tags: readonly string[];
  readonly suggestions: readonly string[];
  readonly onChange: (tags: readonly string[]) => void;
  readonly disabled?: boolean;
}): ReactNode {
  const [word, setWord] = useState("");
  const listId = useId();
  const add = (): void => {
    const changed = withTag(tags, word);
    setWord("");
    if (changed !== tags) onChange(changed);
  };
  return (
    <div className="tags-input" role="group" aria-label="Tags">
      {tags.map((tag) => (
        <Tag
          key={tag}
          {...(!disabled && { onRemove: () => onChange(tags.filter((each) => each !== tag)) })}
        >
          {tag}
        </Tag>
      ))}
      <input
        className="tags-input-box"
        aria-label="Add a Tag"
        placeholder="Add a Tag"
        list={listId}
        value={word}
        disabled={disabled}
        onChange={(event) => setWord(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          } else if (event.key === "Backspace" && word === "" && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
      />
      <datalist id={listId}>
        {suggestions
          .filter((tag) => !tags.includes(tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
    </div>
  );
}
