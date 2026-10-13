# Security policy

Monet is a development preview. Security fixes target the current `main` branch;
there is no supported stable release series yet.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/monetone/monet/security/advisories/new)
when the repository's **Report a vulnerability** button is available. If that
channel is unavailable, email [info@unifiedsense.com](mailto:info@unifiedsense.com),
the contact published on [Unified Sense's legal page](https://unifiedsense.com/legal),
with the subject **Monet security report**. This is the existing general contact
address, not a dedicated security mailbox.

Include the affected app/component and commit, platform, reproduction steps,
expected security boundary, impact and a minimal proof of concept. Use synthetic
documents and redact secrets, personal data and MCP authentication tokens.
Keep exploit details and sensitive attachments out of public issues and pull
requests while maintainers investigate. Ordinary non-security bugs belong in
the [issue tracker](https://github.com/monetone/monet/issues).

The private GitHub reporting channel must be enabled and verified as part of
[the public source launch](docs/open-source-release.md). This document does not
claim that repository settings have already been configured.
