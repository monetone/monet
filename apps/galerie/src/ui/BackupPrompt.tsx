// BackupPrompt — Lightroom's exit-time "Back Up Catalog" dialog: shown when the
// schedule says a backup is due as the window closes. The frequency select
// persists immediately; Back Up runs the backup then quits, Skip quits without
// one, Cancel keeps the app open.

import { Button, Dialog, Field, Select } from "@monet-ui/monet-react";
import { useState } from "react";

import {
  loadBackupPolicy,
  saveBackupPolicy,
  type BackupFrequency,
} from "../lib/backupPolicy";

const FREQ_OPTIONS: { value: BackupFrequency; label: string }[] = [
  { value: "never", label: "Never" },
  { value: "always", label: "Every time Galerie exits" },
  { value: "daily", label: "Once a day" },
  { value: "weekly", label: "Once a week" },
];

export function BackupPrompt({
  busy,
  onBackup,
  onSkip,
  onCancel,
}: {
  /** A backup is running — disable the buttons. */
  busy: boolean;
  onBackup: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const [frequency, setFrequency] = useState<BackupFrequency>(() => loadBackupPolicy().frequency);
  return (
    <Dialog
      open
      onClose={onCancel}
      title="Back Up Catalog"
      width={400}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onSkip}>
            Skip &amp; Quit
          </Button>
          <Button variant="primary" disabled={busy} onClick={onBackup}>
            {busy ? "Backing up…" : "Back Up & Quit"}
          </Button>
        </>
      }
    >
      <div className="gal-modal-msg">
        A catalog backup is due. Backups are point-in-time copies saved next to
        your catalog data.
      </div>
      <Field label="Back up">
        {(p) => (
          <Select
            {...p}
            value={frequency}
            options={FREQ_OPTIONS}
            onChange={(v) => {
              const f = v as BackupFrequency;
              setFrequency(f);
              const cur = loadBackupPolicy();
              saveBackupPolicy({ ...cur, frequency: f });
            }}
          />
        )}
      </Field>
    </Dialog>
  );
}
