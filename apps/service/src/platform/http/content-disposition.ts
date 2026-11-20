/**
 * A Content-Disposition header naming the file: in ASCII for old clients, and in full as RFC 6266
 * and RFC 8187 write it, so any name survives the header.
 */
export function dispositionOf(kind: "inline" | "attachment", name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
