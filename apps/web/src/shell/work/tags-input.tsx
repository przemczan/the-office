import { Tag } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { withTag } from "./tag-words.ts";
import "./tags-input.css";

/**
 * A Task's Tags as chips, each removable, and a box adding one on Enter or a comma, suggesting the
 * Tags in use; Backspace in the empty box removes the last. Other lists of keys, such as a Stage's
 * Project commands, name the group and the box their own way.
 */
export function TagsInput({
  tags,
  suggestions,
  onChange,
  disabled = false,
  label = "Tags",
  addLabel = "Add a Tag",
  placeholder = addLabel,
}: {
  readonly tags: readonly string[];
  readonly suggestions: readonly string[];
  readonly onChange: (tags: readonly string[]) => void;
  readonly disabled?: boolean;
  /** The group's accessible name. */
  readonly label?: string;
  /** The box's accessible name. */
  readonly addLabel?: string;
  readonly placeholder?: string;
}): ReactNode {
  const [word, setWord] = useState("");
  const listId = useId();
  const add = (): void => {
    const changed = withTag(tags, word);
    setWord("");
    if (changed !== tags) onChange(changed);
  };
  return (
    <div className="tags-input" role="group" aria-label={label}>
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
        aria-label={addLabel}
        placeholder={placeholder}
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
