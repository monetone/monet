# C2PA Content Credentials — signing

Monet Vision can embed a cryptographically signed [C2PA](https://c2pa.org) manifest
into an exported PNG (File ▸ Export ▸ Content Credentials (Signed)). Signing is
**native-only** — the browser/dev build has no crypto and falls back to an unsigned
JSON sidecar. The signer is configured in **Preferences ▸ Content Credentials**.

## Dev signer vs. a real certificate

Out of the box, exports are signed with a **self-signed development key** (ES256)
generated when Vision is built. The key is not stored in the repository. It proves
the pipeline works and round-trips through any C2PA reader, but it is **not a trust
anchor**: on a verifier such as
[contentcredentials.org/verify](https://contentcredentials.org/verify) a self-signed
signer shows an **untrusted-signer** banner rather than a named organization.

To sign as a recognized identity you import your **own** certificate + private key:

- **Self-signed (your own key):** Verify still shows "untrusted", but the manifest is
  bound to *your* cert (issuer, serial). Fine for internal provenance.
- **CA-issued:** A certificate chaining to a CA in the verifier's trust list shows your
  **named organization**. C2PA validators generally expect an end-entity certificate
  with the *Email Protection* extended key usage (`id-kp-emailProtection`), per the
  [C2PA trust model](https://spec.c2pa.org). Obtain one from a certificate authority
  that issues document/content-signing certs, or from a member of the
  [C2PA / CAI trust list](https://opensource.contentauthenticity.org/docs/verify-known-cert-list).

Supported algorithms are auto-detected from the key: **ES256, ES384, PS256, Ed25519**.

## Importing

Preferences ▸ Content Credentials ▸ *Import Certificate…* / *Import Key…* (PEM files),
optionally a **Timestamp URL**, then *Use This Certificate*. Import **validates by
actually signing** the built-in 1-pixel fixture and reading the manifest back — a
mismatched cert/key or unsupported algorithm is rejected before anything is written,
so a bad pair can never become the active signer. *Remove* reverts to the dev signer.

## Timestamps (RFC-3161) — what leaves the device

The Timestamp URL is **optional and empty by default**. When set, each export makes a
**user-initiated** RFC-3161 request to that timestamp authority (TSA): Monet Vision
sends a **hash of the signature** (a timestamp query, `application/timestamp-query`) —
never your image, key, or manifest content — and embeds the signed timestamp token so
the signature can be proven to predate certificate expiry/revocation. This is the only
network egress in the signing path. Leave the field empty to keep signing fully local.

## Key at rest

An imported certificate and private key are stored as plain files under the app data
directory (`c2pa/cert.pem`, `c2pa/key.pem`, `c2pa/tsa`). On macOS/Linux the private
files are written **owner-only (`0600`)**. The key bytes transit IPC once at import and
are never persisted by the frontend.

This is a deliberate, documented posture, not keychain-backed storage. **Upgrade path:**
back the private key with the OS keychain / Secure Enclave (Security.framework) so the
key never lands on disk in the clear — deferred because it needs platform bindings and a
signing-algorithm dance for marginal gain in a per-user app-data directory.

## Production trust anchor — the runbook (plan 08 §2)

The dev signer proves the pipeline; verifiers show it as **untrusted**. To make
exports verifiable, import a certificate whose chain a C2PA validator trusts.

### 1. What the certificate must be

Per the C2PA specification's signer requirements, the leaf certificate must:

- be an X.509 v3 cert whose **Key Usage includes `digitalSignature`**, and whose
  **Extended Key Usage is `emailProtection` (S/MIME) and/or `id-kp-documentSigning`**
  (the two EKUs C2PA validators accept for claim signing);
- use a key type Monet Vision can sign with: **ES256, ES384, PS256, or Ed25519**
  (`detect_alg` in `c2pa_sign.rs` auto-detects by trial-signing at import);
- chain to a CA that verifiers trust. contentcredentials.org/verify validates
  the chain; membership on the C2PA/CAI known-certificate list is what removes
  the "unknown source" caveat for public-facing use.

### 2. Getting one (the user action)

- **Commercial CA** — a document-signing or S/MIME certificate from a public CA
  (e.g. DigiCert, GlobalSign, Sectigo) with the EKUs above. Ask explicitly for
  C2PA/document-signing suitability; S/MIME certs commonly carry
  `emailProtection` and work today.
- **Organisation-internal CA** — issue a leaf with the same profile from your
  own CA. Exports verify inside any environment that trusts that CA (fine for
  studio-internal provenance; public verifiers will still show unknown-source).
- Export the leaf + private key as **PEM** (cert chain in `cert.pem` order:
  leaf first; key unencrypted PEM — it is stored `0600` in app data, see above).

### 3. Import + verify checklist

1. Preferences ▸ Content Credentials ▸ Import — pick the cert and key PEMs
   (a TSA URL is optional; see the timestamp section above).
2. The panel's signer info must now show `kind: custom` with your issuer and
   serial (that readback IS a live test-sign — if it renders, signing works).
3. File ▸ Export ▸ Content Credentials (Signed)… → export a PNG (or JPEG/TIFF).
4. Drop the file on https://contentcredentials.org/verify — the credential must
   list your issuer, and must NOT carry the dev-signer untrusted warning.
5. Optional: verify offline with `c2patool <file>` — the manifest's
   `signature_info` shows the same issuer/serial.

Removing the imported pair (Preferences ▸ Clear) reverts to the dev signer on
the next export — nothing caches.
