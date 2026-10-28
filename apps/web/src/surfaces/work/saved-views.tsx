import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BoardFilters, SavedView } from "@the-office/contracts";
import { Button, Dialog, Icon, Input } from "@the-office/ui";
import { useId, useState, type ReactNode } from "react";
import { removeView, savedViewsQuery, saveView } from "../../api/work.ts";
import { RefusalAlert } from "../../shell/refusal-alert.tsx";
import { useToast } from "../../shell/toasts.tsx";
import { hasBoardFilters, sameBoardFilters } from "./board-filters.ts";

/**
 * The board's "Views" (prototypes/app/work.js `work-view`): a view is on while the board's filters
 * are its own, so changing any filter turns it off. Picking the view that is on clears the filters.
 */
export function SavedViewsRow({
  filters,
  onChange,
}: {
  readonly filters: BoardFilters;
  readonly onChange: (filters: BoardFilters) => void;
}): ReactNode {
  const views = useQuery(savedViewsQuery());
  const [saving, setSaving] = useState(false);
  const chosen = views.data?.find((view) => sameBoardFilters(view.filters, filters));
  const canSave = hasBoardFilters(filters) && chosen === undefined;
  return (
    <>
      {((views.data?.length ?? 0) > 0 || canSave) && (
        <div className="board-filters-row" role="group" aria-label="Views">
          <span className="board-filters-label">Views</span>
          {views.data?.map((view) => (
            <ViewChip
              key={view.id}
              view={view}
              on={view === chosen}
              onPick={() => onChange(view === chosen ? {} : view.filters)}
            />
          ))}
          {canSave && (
            <Button
              size="sm"
              variant="secondary"
              iconLeft={<Icon name="bookmark-plus" size={13} />}
              onClick={() => setSaving(true)}
            >
              Save view…
            </Button>
          )}
        </div>
      )}
      {saving && <SaveViewDialog filters={filters} onClose={() => setSaving(false)} />}
    </>
  );
}

function ViewChip({
  view,
  on,
  onPick,
}: {
  readonly view: SavedView;
  readonly on: boolean;
  readonly onPick: () => void;
}): ReactNode {
  const queryClient = useQueryClient();
  const showToast = useToast();
  const removing = useMutation({
    mutationFn: () => removeView(view.id),
    onSuccess: () => queryClient.invalidateQueries(savedViewsQuery()),
    onError: (error) => showToast(error.message),
  });
  return (
    <span className="board-view-chip" data-on={on}>
      <button type="button" aria-pressed={on} onClick={onPick}>
        <Icon name="bookmark" size={12} />
        {view.name}
      </button>
      <button
        type="button"
        className="board-view-remove"
        aria-label={`Remove the view ${view.name}`}
        title="Remove the view"
        disabled={removing.isPending}
        onClick={() => removing.mutate()}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

function SaveViewDialog({
  filters,
  onClose,
}: {
  readonly filters: BoardFilters;
  readonly onClose: () => void;
}): ReactNode {
  const formId = useId();
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const saving = useMutation({
    mutationFn: () => saveView({ name, filters }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(savedViewsQuery());
      onClose();
    },
  });
  return (
    <Dialog
      title="Save the view"
      width={440}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving.isPending}>
            Save view
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="work-form"
        onSubmit={(event) => {
          event.preventDefault();
          saving.mutate();
        }}
      >
        {saving.error && <RefusalAlert title="The view can't be saved" error={saving.error} />}
        <Input
          label="Name"
          placeholder="Firmware bugs"
          value={name}
          hint="A view saves the filters, not the Project filter: it follows the top bar like everything else."
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </form>
    </Dialog>
  );
}
