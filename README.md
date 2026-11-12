# Madis Pass

> **Status: design stage. No release, no downloadable build, no implementation yet.**
> This repository contains product documentation only. It contains no source code, private keys, workflows or internal artifacts.

A small, fully offline, single-user password manager for the desktop. One master password unlocks one local encrypted vault; a tray icon and a global hotkey let you find an entry and copy its password quickly.

Publisher **Madis** · identifier **`top.madis.pass`** · binary **`madis-pass`**.

## Design goals

- **Very small footprint**: Rust + Slint software renderer, no WebView, no GPU runtime, no database engine, no network stack.
- **Offline by design in v1**: no account, no cloud sync, no telemetry, no update checks, no outbound requests.
- **One encrypted file**: the whole vault lives in `pass.mpv1`; backups are copies of the same encrypted file.
- **Lock down quickly**: idle / session-lock / sleep auto-lock, clipboard auto-clear, no plaintext in UI models.

## Planned v1 features

Create / unlock / lock a vault, change master password, entry CRUD and local search, CSPRNG password generator, clipboard copy with auto-clear, encrypted backup and restore, portable mode, tray and global hotkey, light/dark theme, Simplified Chinese / English.

Explicitly **not** in v1: cloud sync, accounts, browser extensions, system-wide autofill, TOTP / passkeys, attachments, team sharing, telemetry, online updates, KDBX writing, mobile apps.

## Open vault format

The vault format is published as a standalone specification so it can be verified independently of the (private) implementation:

- [MPV1 vault format specification (Chinese)](docs/MPV1-密文格式规范.md) — byte layout, Argon2id parameters, XChaCha20-Poly1305 usage, canonical JSON schema, verification steps and error conditions.
- `madis-pass-probe`, planned as a separately built CLI, will verify headers and authentication tags using an independent parser. Fixed test vectors will be published with the first implementation; **none exist yet**.

Format: Argon2id v1.3 (`m=64 MiB`, `t=3`, `p=4`) → HKDF-SHA256 → XChaCha20-Poly1305 with the 88-byte header as AAD. Unlocking intentionally consumes 64 MiB+ of memory for a fraction of a second; this is a brute-force resistance cost, not a defect.

## Security boundaries (read this)

- The source code of the application is **private**. What is public is the format specification, the planned verification tool and the threat model below. The product has **not** been audited by a third party.
- **No master password recovery, reset or hint.** If you forget it, the vault cannot be recovered. Back up the encrypted file.
- Not defended against: local administrators or same-user malware, keyloggers, screenshots / screen recording, clipboard managers or clipboard history, remote desktop sessions, OS page files / hibernation files / crash dumps, cold-boot attacks, filesystem snapshots, cloud-sync history, old encrypted backups made before a password change, hardware debugging or side-channel attacks.
- Clipboard auto-clear (default 15 s) only clears the value if it is still the one this app wrote; it cannot remove copies held by other software.
- Plaintext CSV export (if added later) is not encrypted and must be deleted securely after use.
- No claim of "zero CPU", "unbreakable", or "audited" is made. Any performance figure must come from a controlled measurement report that does not yet exist.

## Data locations

| Platform | Data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Madis\Pass\Data` |
| macOS | `~/Library/Application Support/Madis/Pass/Data` |
| Linux | `$XDG_DATA_HOME/Madis/Pass/Data`, or `~/.local/share/Madis/Pass/Data` |

Install directory (Windows): `%LOCALAPPDATA%\Programs\Madis\Pass`. Installation and data are kept separate; uninstall preserves user data. Portable mode uses `Data/` beside the executable — do not place it in a cloud-synced or shared folder.

## Downloads

Not available yet. When releases exist, use only the official GitHub / Gitee release pages of this repository; do not use third-party mirrors. `SHA256SUMS` detects download corruption only — it is not a signature.

## Licensing and attribution

Madis Pass binaries are proprietary freeware distributed under their own license text; the source code is not published. Built with [Slint](https://slint.dev) under the Royalty-Free License 2.0 — **Made with Slint**. Third-party dependency licenses will be listed with the first release; Slint's license does not license the whole product.

Third-party projects that informed this design include `pass` / `pash`, `SpicyPass`, KeePass / KeePassXC, `ripasso` and the RustCrypto crates. Their audits and certifications are **not** claims about this product.
