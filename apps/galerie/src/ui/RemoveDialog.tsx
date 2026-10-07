// RemoveDialog — confirm Lightroom's Delete/⌫: "Remove" drops the photos'
// catalog rows only (source files kept on disk); "Delete from Disk" also moves
// the source files (and managed DNG copies) to the OS Trash. Cascades
// (collection membership, previews, snapshots, history, keywords, virtual
// copies) are handled by the catalog's ON DELETE CASCADE.

import { Button, Dialog } from "@monet-ui/monet-react";

export function RemoveDialog({
  count,
  onClose,
  onConfirm,
  onDelete,
}: {
  count: number;
  onClose: () => void;
  onConfirm: () => void;
  /** When set, offers Lightroom's destructive "Delete from Disk" beside Remove. */
  onDelete?: () => void;
}) {
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Remove ${count} Photo${count === 1 ? "" : "s"} from Catalog`}
      width={440}
      footer={
        <>
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              Delete from Disk
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Remove
          </Button>
        </>
      }
    >
      <div className="gal-modal-msg">
        Remove {count === 1 ? "this photo" : `these ${count} photos`} from the catalog? Virtual
        copies are removed too. Remove keeps the source files on disk
        {onDelete ? "; Delete from Disk moves them to the Trash" : ""}.
      </div>
    </Dialog>
  );
}
