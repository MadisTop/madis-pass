# MPV1 公开测试向量

> 全部为**假数据**：不含任何真实凭据、真实主密码或用户密文库。与私有源码仓 `tests/格式回归向量/` 是同一批字节。
> 对应规范：[MPV1 密文格式规范](../MPV1-密文格式规范.md)。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `vault.mpv1` | 正确样本：一个含单条假条目的完整 MPV1 密文库 |
| `password.txt` | 该样本使用的**测试专用**主密码（假数据，明文仅因它是公开向量） |
| `wrong-password.txt` | 错误主密码样本（假数据） |
| `manifest.json` | 机器可读清单：`valid` 为应通过的样本，`rejected` 为应被拒绝的样本 |
| `tamper-magic.mpv1` | 偏移 0 的 magic 位被翻转 |
| `tamper-version.mpv1` | 偏移 4 的 `format_version` 被翻转 |
| `tamper-flags.mpv1` | 偏移 6 的 `flags` 被翻转 |
| `tamper-kdf-memory.mpv1` | 偏移 12 的 `kdf_memory_kib` 被翻转（仍在合法范围内，靠 AAD 校验拒绝） |
| `tamper-header-size.mpv1` | 偏移 72 的 `header_size` 被翻转 |
| `tamper-reserved.mpv1` | 偏移 76 的保留位被翻转 |
| `tamper-ciphertext.mpv1` | 密文 / 标签最后一位被翻转 |
| `truncated.mpv1` | 末尾少 1 字节 |
| `appended.mpv1` | 末尾多 1 字节 |

## 期望行为

- `vault.mpv1` 用 `password.txt` 的内容必须通过头解析与 Poly1305 标签校验；用 `wrong-password.txt` 的内容必须失败。
- `rejected` 中的九个样本：要么在无秘密的头校验阶段被拒绝，要么在标签校验阶段被拒绝；**任何一个都不允许解密成功**。
- 头篡改之所以能被发现，是因为完整 88 字节头整体作为 AEAD 的 AAD，而不是因为文件里存了校验和。

## 如何自验

使用随 Windows 便携包分发的 `madis-pass-probe.exe`：

```text
madis-pass-probe.exe header vault.mpv1
madis-pass-probe.exe self-test <本目录>
madis-pass-probe.exe verify vault.mpv1
```

`verify` 会交互式读取主密码（不从命令行参数传入，避免进入进程列表与命令历史）；输入 `password.txt` 的内容后应输出 `OK` 与载荷摘要。`self-test` 一次重放全部 13 个文件，输出 `OK 全部测试向量通过`。

有私有源码仓访问权限时，也可用 `cargo run --locked -p madis-pass-probe -- self-test tests/格式回归向量` 对同一批字节做双向互校。

## 重新生成与同步

`make-vector` 时的盐与 nonce 来自 OS CSPRNG，因此**每次生成的 `vault.mpv1` 字节不同**；本目录是一份固定快照。若重新生成，必须同时更新私有源码仓 `tests/格式回归向量/`、本目录、公开规范中的相关描述，并重新跑 `self-test`；两边必须保持逐字节一致，否则公开向量失去意义。

## 边界

这些向量是**格式回归数据**，用于验证「规范不是实现代码的镜像描述」以及「篡改必定被拒绝」。它们不是加密实现的正确证明，不构成安全审计，也不提供任何抗侧信道、抗内存读取或抗离线爆破能力的证据。
