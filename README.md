# Madis Pass

> **Status: v1 implemented (Windows x64). No official GitHub / Gitee Release yet; no third-party security audit.**
> This repository contains product documentation only. It contains no source code, private keys, workflows or internal artifacts.

A small, fully offline, single-user password manager for the desktop. One master password unlocks one local encrypted vault; a tray icon and a global hotkey let you find an entry and copy its password quickly.

Publisher **Madis** · identifier **`top.madis.pass`** · binary **`madis-pass`** · version **0.1.0**.

## What v1 actually does

Implemented and covered by unit / format regression tests:

- Create / unlock / lock a vault; change the master password.
- Entry CRUD, favourites, tags, notes, custom fields and local search.
- CSPRNG password generator; clipboard copy with auto-clear.
- Encrypted backup / restore; atomic writes with a rotated `.mpv1.bak`.
- Idle lock, session lock (two consecutive confirmations), manual lock, lock on exit.
- Tray, quick-search window, `Ctrl+Alt+P` / `Ctrl+Alt+L` global hotkeys.
- Portable mode, light/dark theme, Simplified Chinese / English.

Explicitly **not** in v1: cloud sync, accounts, browser extensions, system-wide autofill, TOTP / passkeys, attachments, entry history, team sharing, telemetry, online updates, KDBX writing, mobile apps.

## Design goals and measured boundaries

- **Very small footprint**: Rust + Slint software renderer, no WebView, no GPU runtime, no database engine, no network client. A single encrypted file plus an in-memory index after unlock.
- **Offline by design in v1**: no account, no cloud sync, no telemetry, no update checks, no outbound requests from the main program.
- **One encrypted file**: the whole vault lives in `pass.mpv1`; backups are copies of the same encrypted file.
- **Lock down quickly**: idle / session-lock auto-lock, clipboard auto-clear, no plaintext in UI list models.
- Resource figures are published only from controlled measurements (see the private source repo's acceptance notes). Unlocking intentionally consumes 64 MiB+ for a fraction of a second — that is Argon2id brute-force resistance, not a defect, and is reported separately from idle-state memory. No claim of "zero CPU" is made.

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
- No claim of "zero CPU", "unbreakable", "secure" or "audited" is made.

## Data locations

| Platform | Data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Madis\Pass\Data` |
| macOS | `~/Library/Application Support/Madis/Pass/Data` |
| Linux | `$XDG_DATA_HOME/Madis/Pass/Data`, or `~/.local/share/Madis/Pass/Data` |

The directory contains only MPV1 ciphertext (`pass.mpv1`, previous version `pass.mpv1.bak`) and non-secret `state.json` / `ui.json`. **No plaintext vault file is written to disk.** macOS / Linux builds are not yet produced.

Portable mode uses `Data/` beside the executable — do not place it in a cloud-synced or shared folder. `--data-file <path>` selects a standalone vault file; it is rejected when combined with portable mode.

## Downloads

No official Release is published yet. When releases exist, use only the official GitHub / Gitee release pages of this repository; do not use third-party mirrors. `SHA256SUMS` detects download corruption only — it is not a signature. v1 has no in-app updater; upgrading is manual.

A locally built Windows x64 portable ZIP is produced from the private source repo's `release/windows/构建便携包.ps1`; it contains the executable, this README, the license text, the format specification and the probe tool. Local portable builds are **not signed** (`not-verified`) and are not an official release.

## Licensing and attribution

Madis Pass binaries are proprietary freeware distributed under [LICENSE.txt](LICENSE.txt); the source code is not published. Built with [Slint](https://slint.dev) under the Royalty-Free License 2.0 — **Made with Slint**. Third-party dependency licenses are summarised with the first official release; Slint's license does not license the whole product.

Third-party projects that informed this design include `pass` / `pash`, `SpicyPass`, KeePass / KeePassXC, `ripasso` and the RustCrypto crates. Their audits and certifications are **not** claims about this product.
