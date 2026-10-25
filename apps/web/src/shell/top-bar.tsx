import { Button, Icon, Logo } from "@the-office/ui";
import type { ReactNode } from "react";
import { useBrandTone } from "./brand-tone.ts";

/** The lockup, the page's title and "Idea", which opens the Idea capture from task 10 on. */
export function TopBar({ title }: { readonly title: string | undefined }): ReactNode {
  return (
    <header className="shell-top">
      <span className="shell-top-lockup">
        <Logo size={20} product="The Office" tone={useBrandTone()} />
      </span>
      <span className="shell-top-divider" />
      <h1>{title}</h1>
      <span className="shell-grow" />
      <Button variant="secondary" iconLeft={<Icon name="plus" size={14} />}>
        Idea
      </Button>
    </header>
  );
}
