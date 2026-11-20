import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
  FILE_PREVIEW_BYTES,
  type Project,
  type ProjectBranch,
  type RepositoryFilePreview,
} from "@the-office/contracts";
import { Button, EmptyState, Icon, SegmentedControl } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { projectQueries, repositoryFileAddress } from "../../api/projects.ts";
import { PlainTextFile } from "../../shell/attachments/plain-text-file.tsx";
import { useCopyText } from "../../shell/copy-text.ts";
import { MarkdownDocument } from "../../shell/markdown-text.tsx";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import {
  fileSizeWords,
  isMarkdownPath,
  nameOf,
} from "../../shell/repository-files/repository-files-words.ts";

/** One file of a branch: its name and actions, then the file as its kind shows. */
export function FilePreview({
  project,
  branch,
  path,
}: {
  readonly project: Project;
  readonly branch: ProjectBranch;
  readonly path: string;
}): ReactNode {
  const preview = useQuery(projectQueries.filePreview(project.id, branch.commit, path));
  const download = repositoryFileAddress(project.id, branch.commit, path, { download: true });
  return (
    <>
      <FileHead project={project} branch={branch} path={path} download={download} />
      {preview.error && <RefusalAlert title="This file can't be read" error={preview.error} />}
      {preview.isPending && <p className="files-quiet">Reading the file…</p>}
      {preview.data && (
        <PreviewBody
          // A Markdown file opens rendered, whichever way the last one was shown.
          key={path}
          preview={preview.data}
          path={path}
          inline={repositoryFileAddress(project.id, branch.commit, path, { download: false })}
          download={download}
        />
      )}
    </>
  );
}

function FileHead({
  project,
  branch,
  path,
  download,
}: {
  readonly project: Project;
  readonly branch: ProjectBranch;
  readonly path: string;
  readonly download: string;
}): ReactNode {
  const router = useRouter();
  const copyText = useCopyText();
  const copyLink = (): void => {
    const { href } = router.buildLocation({
      to: "/projects/$projectId/files",
      params: { projectId: project.id },
      search: { branch: branch.name, path },
    });
    const url = new URL(href, window.location.origin).href;
    copyText(url, { copied: "Link copied.", notCopied: `The link couldn't be copied: ${url}` });
  };
  return (
    <header className="files-preview-head">
      <h3 className="files-preview-name" title={path}>
        {nameOf(path)}
      </h3>
      <div className="files-preview-actions">
        <DownloadLink href={download} />
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Icon name="copy" size={14} />}
          onClick={() =>
            copyText(path, {
              copied: "Path copied.",
              notCopied: `The path couldn't be copied: ${path}`,
            })
          }
        >
          Copy path
        </Button>
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Icon name="link" size={14} />}
          onClick={copyLink}
        >
          Copy link
        </Button>
      </div>
    </header>
  );
}

function DownloadLink({ href }: { readonly href: string }): ReactNode {
  return (
    <a className="link-button" href={href} download>
      <Icon name="download" size={14} />
      Download
    </a>
  );
}

function PreviewBody({
  preview,
  path,
  inline,
  download,
}: {
  readonly preview: RepositoryFilePreview;
  readonly path: string;
  readonly inline: string;
  readonly download: string;
}): ReactNode {
  const [shownAs, setShownAs] = useState<"rendered" | "source">("rendered");
  switch (preview.kind) {
    case "text":
      if (!isMarkdownPath(path)) return <PlainTextFile text={preview.text} />;
      return (
        <div className="files-preview-markdown">
          <SegmentedControl
            size="sm"
            value={shownAs}
            onChange={(value) => setShownAs(value === "source" ? "source" : "rendered")}
            options={[
              { value: "rendered", label: "Rendered" },
              { value: "source", label: "Source" },
            ]}
          />
          {shownAs === "rendered" ? (
            <MarkdownDocument text={preview.text} />
          ) : (
            <PlainTextFile text={preview.text} />
          )}
        </div>
      );
    case "image":
      return <img className="files-preview-image" src={inline} alt={nameOf(path)} />;
    case "binary":
    case "too-large":
      return (
        <EmptyState
          icon="file-x"
          title="This file can't be previewed"
          description={unpreviewedWords(preview)}
          action={<DownloadLink href={download} />}
        />
      );
  }
}

function unpreviewedWords({ kind, size }: RepositoryFilePreview): string {
  return kind === "too-large"
    ? `It is ${fileSizeWords(size)}, over the ${fileSizeWords(FILE_PREVIEW_BYTES)} a preview shows. Download it to read it.`
    : `It holds binary data (${fileSizeWords(size)}). Download it to open it.`;
}
