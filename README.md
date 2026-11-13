# Madis Pass

> **Status: v1 implemented, four-target capability in place; only the Windows x64 portable build is verified locally. No official GitHub / Gitee Release yet; no third-party security audit.**
> This repository contains product documentation and the public distribution contract only — no source code, private keys, workflows or internal artifacts.

A small, single-user password manager for the desktop. One master password unlocks one local encrypted vault; a tray icon and a global hotkey let you find an entry and copy its password quickly. **The vault path is fully offline**; the updater is the only separate outbound channel, and it is currently disabled.

Publisher **Madis** · identifier **`top.madis.pass`** · binary **`madis-pass`** · version **0.1.0**.

## What is implemented

- Create / unlock / lock a vault; change the master password.
- Entry CRUD, favourites, tags, notes, custom fields and local search.
- CSPRNG password generator; clipboard copy with auto-clear.
- Encrypted backup / restore; atomic writes with a rotated `.mpv1.bak`.
- Idle lock, session lock (two consecutive confirmations), manual lock, lock on exit.
- Tray, quick-search window, `Ctrl+Alt+P` / `Ctrl+Alt+L` global hotkeys (Windows).
- Portable mode and `--data-file` for a standalone vault file.
- **Three-state dark mode**: follow system / light / dark, applied immediately and persisted.
- **Three-state Chinese / English**: follow system / Simplified Chinese / English. Static UI strings and runtime notices switch together, in both the main window and the quick-search window.
- **Signed in-app updater**: fixed HTTPS endpoint, Minisign verification, downgrade rejection, size + SHA-256 checks, background check, download then install-and-restart on exit; portable mode only notifies. See [Update and version policy (Chinese)](docs/更新与版本策略.md).
- **Four-target native support**: per-OS detection of system theme, system language, idle time and sign-in startup. See [Four-platform delivery notes (Chinese)](docs/四平台交付说明.md).

Explicitly **not** in v1: cloud sync, accounts, browser extensions, system-wide autofill, TOTP / passkeys, attachments, entry history, team sharing, telemetry, KDBX writing, mobile apps.

### Is automatic updating live?

The client code for checking, verifying, downloading and handing off installation **is implemented and tested**, but the **service is not enabled**: there is no dedicated Minisign trust root, no signed update packages and no deployed update gateway. The compile-time public key is empty, `enabled()` returns `false`, the app makes **no network requests** on startup, and the UI clearly states that automatic updates are not enabled.

This is neither a network failure nor "no update available". It becomes live only after the trust root, offline signing process, endpoint deployment and a real-device upgrade loop are all in place. This repository contains **no** private keys, `.minisig` files, or fabricated public keys / package hashes. In `release.config.json`, `updates.state` is `client-implemented-trust-root-not-configured`, and both `enabled` and `automaticInstall` are `false`.

## Design goals and measured boundaries

- **Very small footprint**: Rust + Slint software renderer, no WebView, no GPU runtime, no database engine. A single encrypted file plus an in-memory index after unlock.
- **Zero network on the vault path**: `pass-crypto` / `pass-store` / `pass-service` do not link the HTTP stack, never read credentials outside the vault, and send no telemetry or vault identifier. The updater is a separate compilation unit, isolated from the ciphertext path.
- **One encrypted file**: the whole vault lives in `pass.mpv1`; backups are copies of the same encrypted file.
- **Lock down quickly**: idle / session-lock auto-lock, clipboard auto-clear, no plaintext in UI list models.
- Resource figures are published only from controlled measurements (see the private source repo's acceptance notes). Unlocking intentionally consumes 64 MiB+ for a fraction of a second — that is Argon2id brute-force resistance, not a defect, and is reported separately from idle-state memory. No claim of "zero CPU" is made. **Idle-state memory has not been measured yet.**

## Open vault format — independently verifiable

The source code is **private**, so the format is published as a standalone specification plus public test vectors:

- [MPV1 vault format specification (Chinese)](docs/MPV1-密文格式规范.md) — byte layout, Argon2id parameters, XChaCha20-Poly1305 usage, canonical JSON schema, verification steps and error conditions.
- [Public MPV1 test vectors](docs/MPV1-测试向量/README.md) — a fixed, fake-data vault, its test master password, a wrong password, nine tampered / truncated / appended samples and a machine-readable `manifest.json`.
- `madis-pass-probe` — a separately built CLI that parses the 88-byte header through an independent code path and verifies the Poly1305 tag. It is shipped with the Windows portable build. `self-test` replays every vector.

Format: Argon2id v1.3 (`m=64 MiB`, `t=3`, `p=4`) → HKDF-SHA256 → XChaCha20-Poly1305 with the 88-byte header as AAD. Test vectors and self-tests are **regression checks, not a security audit**.

## Security boundaries (read this)

- The source code of the application is **private**. What is public is the format specification, test vectors, the verification tool and the threat model below. The product has **not** been audited by a third party.
- **No master password recovery, reset or hint.** If you forget it, the vault cannot be recovered. Back up the encrypted file.
- Not defended against: local administrators or same-user malware, keyloggers, screenshots / screen recording, clipboard managers or clipboard history, remote desktop sessions, OS page files / hibernation files / crash dumps, cold-boot attacks, filesystem snapshots, cloud-sync history, old encrypted backups made before a password change, hardware debugging or side-channel attacks.
- Clipboard auto-clear (default 15 s) only clears the value if it is still the one this app wrote; it cannot remove copies held by other software.
- Plaintext CSV export is not implemented; if added later it will not be encrypted and must be deleted securely after use.
- Automatic updates only accept signed packages from a compile-time fixed endpoint and trust root; even so, they do not protect against supply-chain compromise, local malware or a leaked signing key.
- No claim of "zero CPU", "unbreakable", "secure" or "audited" is made.

## Data locations

| Platform | Data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Madis\Pass\Data` |
| macOS | `~/Library/Application Support/Madis/Pass/Data` |
| Linux | `$XDG_DATA_HOME/Madis/Pass/Data`, or `~/.local/share/Madis/Pass/Data` |

The directory contains only MPV1 ciphertext (`pass.mpv1`, previous version `pass.mpv1.bak`) and non-secret `state.json` / `ui.json`. **No plaintext vault file is written to disk.**

Portable mode uses `Data/` beside the executable — do not place it in a cloud-synced or shared folder. `--data-file <path>` selects a standalone vault file; it is rejected when combined with portable mode. Updating replaces program files only and **never modifies or deletes the user data directory**.

## Four-target delivery and downloads

The target matrix is Windows x64 / Linux x64 / macOS Intel / macOS ARM with nine package formats (NSIS, MSI, AppImage, deb, rpm, dmg, app.tar.gz). Currently **only the Windows x64 portable ZIP is built and verified locally**; native installers, build-repo CI and official releases are templates / unverified. See [Four-platform delivery notes (Chinese)](docs/四平台交付说明.md).

No official Release is published yet. When releases exist, use only the official GitHub / Gitee release pages of this repository; do not use third-party mirrors. `SHA256SUMS` detects download corruption only — it is not a signature.

A locally built Windows x64 portable ZIP is produced from the private source repo's `release/windows/构建便携包.ps1`; it contains the executable, this README, the license text, the format specification, the probe tool and `SHA256SUMS.txt`. Local portable builds are **not signed** (`not-verified`) and are not an official release.

## Licensing and attribution

Madis Pass binaries are proprietary freeware distributed under [LICENSE.txt](LICENSE.txt); the source code is not published. Built with [Slint](https://slint.dev) under the Royalty-Free License 2.0 — **Made with Slint**. Third-party dependency licenses are summarised with the first official release; Slint's license does not license the whole product.

Third-party projects that informed this design include `pass` / `pash`, `SpicyPass`, KeePass / KeePassXC, `ripasso` and the RustCrypto crates. Their audits and certifications are **not** claims about this product.
