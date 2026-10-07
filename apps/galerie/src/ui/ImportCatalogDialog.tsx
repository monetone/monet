// ImportCatalogDialog — Lightroom "Import from Another Catalog…": pick what to
// do about photos this catalog already has, see what the merge WOULD do, then
// commit. The preview is a real dry-run merge in the database (one transaction,
// rolled back), so the numbers on screen are the numbers you get.
//
// ponytail: no per-photo change resolution (LR's side-by-side grid) — the
// choice here is catalog-wide, which is what the laptop→desktop round-trip
// actually needs. Per-photo would want the dry run to return the conflicting
// ids, not just counts; that is the upgrade path.

import { Button, Checkbox, Dialog } from "@monet-ui/monet-react";
import { useEffect, useState } from "react";

import { mergeSummary, store, type CatalogMergeReport } from "../state/store";

export function ImportCatalogDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [preview, setPreview] = useState<CatalogMergeReport | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-preview whenever the resolution changes — "updated" vs "left alone"
  // is exactly what the toggle decides.
  useEffect(() => {
    let live = true;
    setPreview(null);
    void store.importFromCatalog(path, replaceExisting, true).then((report) => {
      if (live) setPreview(report);
    });
    return () => {
      live = false;
    };
  }, [path, replaceExisting]);

  const merge = () => {
    setBusy(true);
    void store.importFromCatalog(path, replaceExisting).then(onClose);
  };

  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Import from Another Catalog"
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={merge} disabled={busy || preview == null}>
            Import
          </Button>
        </>
      }
    >
      <div className="gal-modal-msg">
        Merge <strong>{name}</strong> into the open catalog. Source files are not moved or copied —
        the photos keep pointing at wherever they live now.
      </div>
      <Checkbox checked={replaceExisting} onChange={setReplaceExisting}>
        Replace settings for photos already in this catalog
      </Checkbox>
      <div className="gal-modal-msg" aria-live="polite">
        {preview ? mergeSummary(preview) : "Checking what would change…"}
      </div>
    </Dialog>
  );
}
