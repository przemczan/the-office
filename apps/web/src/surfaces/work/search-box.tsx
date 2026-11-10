import { Icon, Input } from "@the-office/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A filter bar's search box. It keeps what is typed while the address catches up, taking the
 * address's words only when they changed elsewhere (Clear, a Saved view); the address keeps no
 * blank search, so a blank one typed is the same as none.
 */
export function SearchBox({
  query,
  label,
  placeholder,
  onChange,
}: {
  readonly query: string;
  readonly label: string;
  readonly placeholder: string;
  readonly onChange: (query: string) => void;
}): ReactNode {
  const [typed, setTyped] = useState(query);
  const sent = useRef(query);
  useEffect(() => {
    if (query === asKept(sent.current)) return;
    sent.current = query;
    setTyped(query);
  }, [query]);
  return (
    <div className="board-filters-search">
      <Input
        type="search"
        size="sm"
        aria-label={label}
        placeholder={placeholder}
        iconLeft={<Icon name="search" size={14} />}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          sent.current = event.target.value;
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function asKept(typed: string): string {
  return typed.trim() === "" ? "" : typed;
}
