# Source preview and binary releases

Monet's public source is a development preview. A public repository lets people
inspect, build and improve the suite; it does not establish production readiness
or a supported binary release. Keep backups and test copies of valuable files.

## App scope

| App | Preview scope and known limits |
| --- | --- |
| Vision | Broad raster editing; native file workflows, format fidelity and resource limits require regression testing. Optional model weights are not all redistributed. |
| Artisan | Broad vector editing; importer fidelity and tool lifecycle gaps remain documented in its README and QA records. |
| Galerie | Catalog and develop modules; RAW/export accuracy needs real-file and native pipeline checks beyond the unit suite. |
| Rythme | Audio editing and mixing; effect playback uses offline rendering, and VST/AU hosting and compressed export are incomplete. |
| Jouer | 2D scene and animation workflows; its core loop covers a smaller scope than a complete game engine. |
| Cinema | Core video timeline and compositor; codec, native playback and peer-editor scope have gaps. |
| Anime | Core motion composition; advanced editing and compositing workflows remain incomplete. |

The [project site](../site/index.html) contains a more detailed scope inventory.
Its measured test counts describe the stated measurement date, not the current
commit. The [September Vision review](plans/14-vision-release-review.md) is
historical evidence; its original blocker totals are not a current verdict.

## Before making source public

- Verify a clean checkout using [CONTRIBUTING.md](../CONTRIBUTING.md), including
  generated shared packages and all app engine outputs.
- Pass workspace typecheck, lint, unit/documentation tests, all seven MCP
  manifests, the no-skip check and applicable Rust and browser regressions on
  the exact candidate commit. Review the CI result rather than historical counts.
- Audit tracked files and Git history for secrets and private material. Remove
  sensitive material and rotate exposed credentials before changing visibility.
- Complete license and redistribution review for source, bundled assets, models
  and dependencies. This guide does not replace that review.
- Verify the private reporting channel in [SECURITY.md](../SECURITY.md). Enable
  GitHub private vulnerability reporting when making the repository public and
  confirm its **Report a vulnerability** button works.
- Keep the README, announcement and app status descriptions aligned with the
  development-preview scope and link contributors to current known issues.

Repository visibility, reporting settings and public announcements are maintainer
actions; local documentation changes do not perform them.

## Source CI and optional packaged verification

[CI](../.github/workflows/ci.yml) runs workspace checks for pull requests,
`main` pushes and manual dispatches. Main/manual runs also retain full Vision
browser, Artisan, production-CSP and native Rust/no-bundle checks. These source
checks run without signing credentials or self-hosted packaged-smoke adapters.

Packaged macOS and Windows verification is requested explicitly with the manual
**Run packaged binary smoke checks** input. It runs the existing native adapters
and signature/evidence validators; missing configuration or failed checks fail
the requested binary verification. For example, a maintainer can run:

```sh
gh workflow run ci.yml --ref main -f packaged_smoke=true
```

The selected commit must belong to `main` or release history. Self-hosted jobs
consume only the hosted-validated commit behind the protected
`monet-vision-packaged-smoke` environment. An ordinary source CI run supplies no
packaged verification evidence.

## Before publishing desktop downloads

- Pass the source gates on the exact binary candidate commit.
- Provision both native smoke hosts and executable adapters using the
  [packaged-smoke contract](../.github/scripts/packaged-smoke-adapter-contract.md).
  Set `MONET_PACKAGED_SMOKE_MACOS_RUNNER_CONFIGURED` and
  `MONET_PACKAGED_SMOKE_WINDOWS_RUNNER_CONFIGURED` to `true` and supply their
  absolute `MONET_PACKAGED_SMOKE_*_ADAPTER_PATH` repository variables.
- Configure real signing credentials on the release hosts and pin the expected
  Apple Team ID/codesign authority and Windows certificate thumbprint with the
  `MONET_PACKAGED_SMOKE_*` signer variables. Never commit credentials or substitute
  placeholder signer identities.
- Sign macOS/Windows packages, notarize and staple macOS packages, and establish
  the update and supported-platform policy. These facilities are not provisioned
  by the source CI workflow.
- Run explicit packaged verification and inspect the archived results, hashes,
  signer attestations and native evidence for install/launch, open-edit-save-reopen,
  export, recovery and every platform-specific check in the adapter contract.
- Complete the binary dependency/asset notice and redistribution review.

Source availability and passing browser tests do not complete these binary
release requirements.
