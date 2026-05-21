# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest release on [GitHub Releases](https://github.com/gtarun/MyMacCleaner/releases/latest) | Yes |
| Older releases | Best effort |

## Reporting a vulnerability

If you discover a security issue (e.g. path traversal bypassing the allowlist, unsafe deletion, or privilege escalation), **please do not open a public issue** with exploit details.

Instead:

1. Open a [private security advisory](https://github.com/gtarun/MyMacCleaner/security/advisories/new) on GitHub, **or**
2. Contact the maintainer through GitHub with a minimal description so we can coordinate a fix.

We aim to acknowledge reports within a few days and publish a fix or mitigation as soon as practical.

## Scope notes

MacCleaner is a local desktop app with full user-level filesystem access on macOS. Expected risks include:

- **User-confirmed cleanup** — incorrect selections can move important files to Trash (recoverable until Trash is emptied).
- **Unsigned builds** — distributed DMGs are not notarized; users must bypass Gatekeeper once (documented in the README).

Out of scope: issues that require the victim to install a malicious fork, or problems in upstream Electron/React unless they affect MacCleaner’s own IPC or safety boundaries.
