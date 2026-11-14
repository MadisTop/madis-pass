# Madis Pass

[English](README.md) | 简体中文

Madis Pass：基于 Rust 与 Slint 的轻量离线密码管理器，采用 Argon2id 与 XChaCha20-Poly1305（MPV1）端到端加密单文件本地密文库，支持空闲自动锁定与多平台桌面客户端。

发布者 **Madis**；应用标识 **`top.madis.pass`**；正式二进制 **`madis-pass`**；版本 **0.1.1**。

## 支持平台

| 平台 | 安装包格式 |
| --- | --- |
| Windows x64 | NSIS `.exe`、MSI `.msi` |
| Linux x64 | `.AppImage`、`.deb`、`.rpm` |
| macOS Intel | `.dmg`、`.app.tar.gz` |
| macOS Apple Silicon | `.dmg`、`.app.tar.gz` |

Linux 图形会话使用 X11 或 XWayland。请选择与操作系统及处理器架构匹配的安装包，各下载入口提供的格式以对应版本的附件列表为准。安装包命名为 `madis-pass_<版本>_<目标><格式后缀>`，内部可执行文件统一为 `madis-pass`，不因安装包改名而变更程序目录或数据位置。

## 下载入口

- [GitHub 发布页面](https://github.com/MadisTop/madis-pass/releases)
- [Gitee 发布页面](https://gitee.com/madis/madis-pass/releases)

从官方发布页面选择版本并阅读该版本的变更说明，不使用来源不明的转载包。v0.1.1 起以 Release 页面列出的四目标原生安装包、逐包 `SHA256SUMS` 与 Minisign 签名为准；正式发布完成前，任何预览资产都不视为正式安装包。`SHA256SUMS` 仅用于检测下载损坏，**不是数字签名**。

## 安装与使用

- Windows：运行 `.exe` 或 `.msi`，按引导安装到当前用户目录；升级时沿用原安装格式。
- Linux：为 AppImage 添加执行权限后运行，或使用系统包管理器安装 DEB / RPM。
- macOS：打开 DMG 并将应用复制到应用目录，或解压应用归档后运行。
- 首次运行创建本地密文库并设定主密码；之后每次启动需解锁。密文库全程离线，解锁后仅保留内存索引。

主密码不提供找回、重置或提示，遗忘即数据不可恢复，请自行备份密文文件。密文备份与恢复可在应用内完成，写入采用原子方式并轮换上一版 `pass.mpv1.bak`。

### 数据位置与备份

| 平台 | 数据目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Madis\Pass\Data` |
| macOS | `~/Library/Application Support/Madis/Pass/Data` |
| Linux | 有效绝对 `$XDG_DATA_HOME/Madis/Pass/Data`，否则 `~/.local/share/Madis/Pass/Data` |

目录内只有 MPV1 密文（`pass.mpv1` 及上一版备份）与无秘密的 `state.json` / `ui.json`，磁盘上不存在明文库文件。**卸载默认保留**数据目录、设置与备份，不递归删除 Madis 共享父目录；更新只替换程序文件，不改动或删除用户数据。恢复前请先保存当前数据的备份。

### 便携使用（仅 Windows / Linux）

在可执行文件旁手工创建 `portable.json`，内容严格为 `{"version":1}`，或启动时添加 `--portable`。程序不会自动创建该文件；文件存在但无效或不可读会报错，不会悄悄改用用户目录。macOS 明确不支持便携模式，避免向签名 `.app` 包内部写入数据。

- 数据根为实际可执行文件所在目录的 `Data`；退出应用后可连同程序和完整 `Data` 一起移动。
- 请选择可写目录，不要放在云同步盘或共享目录。
- `--data-file <路径>` 可指定独立密文文件；与便携模式同时指定时明确拒绝冲突。
- 便携模式仍可打开官方下载页，但不调用安装型更新器；手动更新程序时保留完整 `Data`。

## 安装安全与隐私

安装或升级前请备份已有数据。未经原生代码签名或 Apple 公证的安装包可能受到 Windows **SmartScreen** 或 macOS **Gatekeeper** 拦截；**不要关闭全局系统安全策略**，请从官方发布页面获取并核对文件。

- `SHA256SUMS` 只检测下载损坏，**不是数字签名**；**Minisign** 更新签名也不能代替平台原生签名或 Apple 公证。
- 密文库和条目内容保存在本地，不需要账号，不提供云同步，**不上传密文库内容**。检查更新与下载安装包需要联网，但只访问固定端点。
- 应用不防御本机管理员或同用户权限的恶意软件、键盘记录器、屏幕截图、剪贴板历史、系统页面文件与崩溃转储等本机威胁；产品未经第三方安全审计。
- 剪贴板自动清空（默认 15 秒）只在内容仍为本程序写入时生效，无法清除其他软件已保存的副本。
- 空闲或会话锁定会自动锁定密文库，退出应用时同样锁定；复制密码后剪贴板自动清空，明文不进入界面列表模型。

## 版本检查与旧版宽限

`release.config.json` 与 `version-policy-v2.json` 描述的是**正式发行目标契约**：固定 HTTPS 端点、Minisign 验签、拒绝降级、包大小与 SHA-256 校验、后台检查、下载完成后退出安装并自动重启、旧版按一个 UTC 自然月截止并另有 14 天离线宽限。

v0.1.1 起客户端已内嵌本项目独立生成的 Minisign 编译期信任根，`enabled()` 返回 `true`，会按固定端点在后台检查更新；但公开更新元数据的 `packages` 在正式发布完成前为空，检查不会获得可用安装包。**实机升级闭环、原生代码签名与 Apple 公证仍待验收**，在此之前请优先从下载页面手动更新。本仓库不含任何私钥，`SHA256SUMS` **不是数字签名**，也不含伪造的包摘要。

程序命名统一为 `madis-pass`，应用标识、安装目录、密文库及备份路径不变。设计参考了 `pass` / `pash`、SpicyPass、KeePass 与 RustCrypto 等项目，这些项目的审计结论不构成对本产品的任何声称。

Madis Pass 二进制为专有免费软件，源码不公开。界面使用 [Slint](https://slint.dev) 构建，采用 Royalty-Free License 2.0，**Made with Slint**。
