import { useQuery } from "@tanstack/react-query";
import type { TestInstance } from "@the-office/contracts";
import { Button, Icon, SplitButton, type ButtonProps, type SplitButtonProps } from "@the-office/ui";
import type { ReactNode } from "react";
import { testInstanceQueries } from "../../api/test-instances.ts";
import { instanceAddress, OPEN_AT_HEADING, OTHER_ADDRESSES } from "./test-instance-words.ts";

/**
 * Open on a Running Hosted instance (spec §2.12, "Reaching a Hosted instance"): it opens the
 * instance at the address this page was opened at; when the instance is reached at others too,
 * its arrow lists every one, `<hostname>:<Proxy port>`, each opening the instance there.
 */
export function OpenTestInstanceButton({
  instance,
  onOpen,
  title,
  size = "md",
  variant = "primary",
  menuPlacement,
}: {
  readonly instance: TestInstance;
  /** Opens it at one of its addresses, by its hostname; the page's own when none. */
  readonly onOpen: (hostname?: string) => void;
  readonly title?: string;
  readonly size?: ButtonProps["size"];
  readonly variant?: ButtonProps["variant"];
  readonly menuPlacement?: SplitButtonProps["menuPlacement"];
}): ReactNode {
  const hostnames = useQuery(testInstanceQueries.addresses()).data?.hostnames ?? [];
  const icon = <Icon name="external-link" size={14} />;
  if (instance.port === null || hostnames.length <= 1) {
    return (
      <Button size={size} variant={variant} iconLeft={icon} title={title} onClick={() => onOpen()}>
        Open
      </Button>
    );
  }
  const { port } = instance;
  return (
    <SplitButton
      size={size}
      variant={variant}
      iconLeft={icon}
      title={title}
      menuLabel={OTHER_ADDRESSES}
      menuWidth={240}
      menuPlacement={menuPlacement}
      onClick={() => onOpen()}
      items={[
        { heading: OPEN_AT_HEADING },
        ...hostnames.map((hostname) => ({
          label: instanceAddress(port, hostname),
          icon,
          onSelect: () => onOpen(hostname),
        })),
      ]}
    >
      Open
    </SplitButton>
  );
}
