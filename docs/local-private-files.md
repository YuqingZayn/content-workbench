# 本地私密文件与 Git 忽略规则

本仓库公开管理应用源码。密钥、账号会话和真实业务资料存放在本机，不作为源码提交。

## 存放目录

在仓库根目录使用 `local-private/`，整个目录及其中的说明文件均被 Git 忽略。本机已经创建该目录；其他电脑克隆仓库后，在仓库目录执行以下 PowerShell 命令即可创建：

```powershell
New-Item -ItemType Directory -Force -Path local-private, local-private/secrets, local-private/credentials, local-private/data, local-private/exports, local-private/backups, local-private/logs
```

| 子目录 | 应放入的文件 |
| --- | --- |
| `secrets/` | API Key、访问令牌、OAuth client secret、数据库密码、含真实值的环境配置、私有签名密钥和证书包 |
| `credentials/` | 服务账号凭据、平台 Cookie、浏览器登录状态、access / refresh token、账号恢复码 |
| `data/` | 真实客户与运营资料、私有素材、账号资料、应用数据库等本地数据 |
| `exports/` | 含真实文案、素材、账号信息的发布包和导出文件 |
| `backups/` | 数据库、项目、配置和业务资料备份 |
| `logs/` | 调试日志、网络 HAR、可能包含令牌或业务内容的错误记录与截图 |

日常运营项目也可以继续使用源码仓库之外的独立文件夹。应用不会自动读取 `local-private/` 中的密钥或配置，这个目录仅用于本地存放；创建它不会改变软件启动方式。

Codex 使用现有 CLI 登录。不要把用户目录下的 `.codex/auth.json` 复制进仓库，也不需要移动该文件。私密目录是普通本地文件夹，不提供加密，也不会自动排除其他网盘或备份软件的同步。

## 已配置的忽略范围

`.gitignore` 除已有的 `.local/`、构建产物、日志、SQLite 文件和 `.content-workspace/` 外，还忽略：

- 整个 `local-private/`，以及仓库根目录的 `backups/`、`exports/`。
- `secrets/`、`credentials/`、`user-data/`、`browser-profile/`、`playwright/.auth/` 和 `.codex/`、`.ssh/`、`.aws/`、`.azure/`。
- `.env*`，但保留 `.env.example`；模板只能填写占位符，不能含真实凭据。
- 常见凭据文件：`auth.json`、`credentials*.json`、`client_secret*.json`、`service-account*.json`、`token.json`、`tokens.json`、Cookie 和浏览器状态 JSON，以及 `.npmrc`、`.pypirc`、`.netrc`。
- `*.pem`、`*.key`、`*.p12`、`*.pfx`、`*.jks`、`*.keystore`、`id_rsa`、`id_ed25519` 等可能携带私钥的文件，以及 `*.har` 网络记录。

当前本机的 `.git/info/exclude` 也保存了这套保护规则，在切换到尚未包含新 `.gitignore` 的分支时仍会生效。该文件不进入 GitHub；其他电脑通过仓库中的 `.gitignore` 获得保护。

任意命名的敏感文件都应放进 `local-private/`，不要只依赖文件名匹配。真实业务项目的整套文件也应放在该目录内或仓库之外；仅忽略数据库并不能保护同目录中的素材和文案。

## 提交前怎么检查

在仓库根目录运行：

```powershell
# 显示生效的忽略规则；路径尚未创建时也可以检查。
git check-ignore -v -- local-private/secrets/api-key.txt .env.local credentials.json

# 理应没有输出；如果有，说明文件虽然匹配忽略规则，但已经被跟踪。
git ls-files -ci --exclude-standard

# 查看本次将上传的文件和内容。
git diff --cached --name-only
git diff --cached
```

只提交源码、经过脱敏的演示数据和文档；允许公开的配置样例必须使用空值或明显的占位符。不要对私密文件执行 `git add -f`，也不要通过 GitHub 网页手工上传这些文件。

Git 忽略规则防止普通添加与提交，不会自动移除已跟踪文件或清除历史记录。若凭据曾进入公开仓库，先在提供方撤销或轮换，再处理跟踪和历史记录；仅删除文件或加入忽略规则不够。

## V0.2 软件录入的发布凭据

平台令牌和 Webhook 在 Electron 用户数据目录 `publishing/credentials.json` 中使用系统 safeStorage 加密，不返回界面，不进入业务项目备份。手工文件仍放 `local-private/`。连接检查不发送帖子，详情见 [连接与恢复](v0.2-publishing.md)。

## 0.2.1 小红书网页会话

小红书登录使用应用用户数据目录中的专用 Chromium `Partitions/`，公开身份状态位于 `web-logins/`。两者均加入 Git 忽略；不要把应用用户数据作为业务项目备份或上传。工作台不提供 Cookie 导出，不读取其他浏览器会话，详见 [网页登录](xiaohongshu-login.md)。
