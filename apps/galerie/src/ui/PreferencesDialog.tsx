// PreferencesDialog — Galerie's first Preferences surface. Today it holds one
// section: Content Credentials, the signing identity Export's "Content
// Credentials (Beta)" checkbox needs (see ExportDialog.tsx and c2pa_sign.rs's
// module docs, both of which call this out as a future Preferences panel —
// this is that panel). Talks only to the three tested Tauri commands the
// backend already exposes: c2pa_signer_info, c2pa_import_signer,
// c2pa_clear_signer. The private key never leaves this component except as
// the exact bytes handed to c2pa_import_signer — never logged, never
// rendered, only its picked file path is shown.

import { Button, Dialog, Field, Input } from "@monet-ui/monet-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";

import { store } from "../state/store";

export interface SignerInfo {
  issuer: string;
  certSerial: string;
  alg: string;
  tsaUrl: string | null;
}

/** Thin, individually-mockable wrappers around the three tested c2pa commands
 *  (`c2pa_sign.rs`) — kept separate from the component so a test can pin the
 *  exact command names/args without rendering or driving DOM events. */
export const fetchSignerInfo = (): Promise<SignerInfo | null> =>
  invoke<SignerInfo | null>("plugin:c2pa|c2pa_signer_info");

export const importSigner = (certPem: string, keyPem: string, tsaUrl: string | null): Promise<SignerInfo> =>
  invoke<SignerInfo>("plugin:c2pa|c2pa_import_signer", { certPem, keyPem, tsaUrl });

export const clearSigner = (): Promise<void> => invoke("plugin:c2pa|c2pa_clear_signer");

function describeSigner(signer: SignerInfo): string {
  const serial = signer.certSerial ? ` · serial ${signer.certSerial}` : "";
  const tsa = signer.tsaUrl ? " · timestamped" : "";
  return `${signer.alg.toUpperCase()} — ${signer.issuer || "Unknown issuer"}${serial}${tsa}`;
}

export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  // undefined = still checking; null = confirmed no signer configured.
  const [signer, setSigner] = useState<SignerInfo | null | undefined>(undefined);
  const [certPath, setCertPath] = useState<string | null>(null);
  const [keyPath, setKeyPath] = useState<string | null>(null);
  const [tsaUrl, setTsaUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    void fetchSignerInfo()
      .then(setSigner)
      .catch((e) => {
        setSigner(null);
        setError(String(e));
      });
  useEffect(refresh, []);

  const pickFile = (title: string, set: (path: string) => void) =>
    void open({ multiple: false, title }).then((path) => {
      if (typeof path === "string") set(path);
    });

  const doImport = async () => {
    if (!certPath || !keyPath) return;
    setBusy(true);
    setError(null);
    try {
      const [certPem, keyPem] = await Promise.all([readTextFile(certPath), readTextFile(keyPath)]);
      const info = await importSigner(certPem, keyPem, tsaUrl.trim() || null);
      setSigner(info);
      setCertPath(null);
      setKeyPath(null);
      setTsaUrl("");
      store.notify("Content Credentials signer imported.");
    } catch (e) {
      // c2pa_import_signer validates by signing before it persists anything,
      // so a rejected import leaves any previously configured signer alone —
      // re-check rather than assume, since we don't duplicate that validation.
      setError(String(e));
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    if (
      !window.confirm(
        "Clear the configured Content Credentials signer? You may not be able to re-import this key — " +
          "exports will fall back to the unsigned sidecar until another signer is imported.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await clearSigner();
      setSigner(null);
      store.notify("Content Credentials signer cleared.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Preferences"
      width={420}
      footer={
        <>
          {error && <span className="gal-modal-msg">{error}</span>}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="gal-export-body">
        <div className="gal-dev-sec-label">Content Credentials</div>
        <div className="gal-modal-msg">
          {signer === undefined
            ? "Checking for a configured signer…"
            : signer === null
              ? "No signer configured — Content Credentials exports fall back to the unsigned sidecar."
              : `Signed as: ${describeSigner(signer)}`}
        </div>
        <Field label="Certificate (.pem)">
          {(p) => (
            <div className="gal-export-inline">
              <Input {...p} block readOnly value={certPath ?? ""} placeholder="Choose a certificate file…" />
              <Button size="sm" onClick={() => pickFile("Choose Signing Certificate", setCertPath)}>
                Choose…
              </Button>
            </div>
          )}
        </Field>
        <Field label="Private key (.pem)">
          {(p) => (
            <div className="gal-export-inline">
              <Input {...p} block readOnly value={keyPath ?? ""} placeholder="Choose a private key file…" />
              <Button size="sm" onClick={() => pickFile("Choose Signing Private Key", setKeyPath)}>
                Choose…
              </Button>
            </div>
          )}
        </Field>
        <Field label="Timestamp authority (optional)" hint="RFC-3161 TSA URL — counter-signs future exports.">
          {(p) => (
            <Input
              {...p}
              block
              value={tsaUrl}
              placeholder="https://…"
              onChange={(event) => setTsaUrl(event.target.value)}
            />
          )}
        </Field>
        <div className="gal-copysettings-all">
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !certPath || !keyPath}
            onClick={() => void doImport()}
          >
            {busy ? "Importing…" : "Import Signer"}
          </Button>
          {signer != null && (
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void doClear()}>
              Clear Signer
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
