# Madis Pass

English | [简体中文](README.zh-CN.md)

Madis Pass: a lightweight offline password manager built with Rust and Slint. It encrypts a single-file local vault with Argon2id and XChaCha20-Poly1305 (MPV1), and supports idle auto-lock and multi-platform desktop clients.

Publisher **Madis** · identifier **`top.madis.pass`** · binary **`madis-pass`** · version **0.1.0**.

## Supported platforms

| Platform | Package formats |
| --- | --- |
| Windows x64 | NSIS `.exe`, MSI `.msi` |
| Linux x64 | `.AppImage`, `.deb`, `.rpm` |
| macOS Intel | `.dmg`, `.app.tar.gz` |
| macOS Apple Silicon | `.dmg`, `.app.tar.gz` |

Linux graphical sessions use X11 or XWayland. Pick the package matching your OS and CPU architecture; the formats available at each download entry are listed in the assets of the corresponding release. Packages are named `madis-pass_<version>_<target><suffix>`; the internal executable is always `madis-pass`, and renaming a package never changes the program directory or data location.

## Downloads

- [GitHub releases](https://github.com/MadisTop/madis-pass/releases)
- [Gitee releases](https://gitee.com/madis/madis-pass/releases)

Choose a version on the official release pages and read its changelog; do not use third-party mirrors. The currently available asset is the v0.1.0 Windows x64 portable ZIP (unsigned, `not-verified`); native installers for the four targets and the update gateway have not been produced yet. `SHA256SUMS` inside the ZIP detects download corruption only — it is not a digital signature.

## Installation and use

- Windows: run the `.exe` or `.msi` and install for the current user; upgrades keep the original install format.
- Linux: make the AppImage executable and run it, or install the DEB / RPM through your package manager.
- macOS: open the DMG and copy the app to Applications, or extract the app archive.
- On first run, create a local vault and set a master password; unlock it on every later start. The vault path is fully offline, with only an in-memory index after unlock.

There is no master password recovery, reset or hint. If you forget it, the vault cannot be recovered — back up the encrypted file yourself. Encrypted backup and restore are available in the app; writes are atomic and rotate the previous `pass.mpv1.bak`.

### Data locations and backups

| Platform | Data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Madis\Pass\Data` |
| macOS | `~/Library/Application Support/Madis/Pass/Data` |
| Linux | absolute `$XDG_DATA_HOME/Madis/Pass/Data`, otherwise `~/.local/share/Madis/Pass/Data` |

The directory holds only MPV1 ciphertext (`pass.mpv1` plus its previous-version backup) and non-secret `state.json` / `ui.json`. No plaintext vault file is written to disk. Uninstalling keeps the data directory, settings and backups by default and never recursively deletes the shared Madis parent directory. Updating replaces program files only and never modifies or deletes user data. Save a backup of the current data before restoring.

### Portable use (Windows / Linux only)

Create `portable.json` beside the executable with exactly `{"version":1}`, or start with `--portable`. The app never creates this file itself; an invalid or unreadable marker produces an error instead of silently falling back to the user directory. macOS explicitly rejects portable mode to avoid writing inside a signed `.app` bundle.

- The data root is `Data` beside the actual executable; quit the app before moving the program and its complete `Data` together.
- Choose a writable directory — not a cloud-synced or shared folder.
- `--data-file <path>` selects a standalone vault file; combining it with portable mode is explicitly rejected.
- Portable mode can still open the official download pages but never invokes an installing updater; keep the complete `Data` when updating manually.

## Installation security and privacy

Back up your data before installing or upgrading. Packages without a native code signature or Apple notarization may be blocked by Windows SmartScreen or macOS Gatekeeper; do not disable global system security policies — obtain and verify files from the official release pages.

- `SHA256SUMS` detects corruption only and is not a digital signature; Minisign update signatures do not replace native platform signing or Apple notarization.
- Vault and entry contents stay local. No account, no cloud sync, no vault content uploaded. Checking for updates and downloading packages requires network access, but only to a fixed endpoint.
- The app does not defend against local administrators, same-user malware, keyloggers, screenshots, clipboard history, OS page files or crash dumps; the product has not been audited by a third party.
- Clipboard auto-clear (15 s by default) only clears the value if the app still owns it; it cannot remove copies held by other software.
- Idle or session lock locks the vault automatically, as does quitting the app. Copied passwords are cleared from the clipboard and plaintext never enters UI list models.

## Version checks and the old-version grace period

`release.config.json` and `version-policy-v2.json` describe the **target stable-release contract**: a fixed HTTPS endpoint, Minisign verification, downgrade rejection, size and SHA-256 checks, a background check, install-on-quit with automatic restart, a one-calendar-UTC-month deadline for old versions and a 14-day offline grace period.

**The automatic update service is not enabled at present.** The compile-time trust root is empty, `enabled()` returns `false`, the app makes no network requests on startup, and the UI clearly asks you to update manually from the download pages. It becomes live only after the trust root, offline signing process, endpoint deployment and a real-device upgrade loop are all in place. This repository contains no private keys and no fabricated public keys or package hashes.

The executable is consistently named `madis-pass`; the identifier, install directory, vault and backup paths do not change. The design drew on `pass` / `pash`, SpicyPass, KeePass and the RustCrypto crates; their audits and certifications are not claims about this product.

Madis Pass binaries are proprietary freeware; the source code is not published. The UI is built with [Slint](https://slint.dev) under the Royalty-Free License 2.0 — **Made with Slint**.
