# 发布 runbook

`dsh-raindrop-plugin` 的发布操作手册。照着从上往下做即可。不随包发布（不在 `package.json` 的 `files` 里）。

## 现状（2026-10-29）

- npm 上 `dsh-raindrop-plugin@0.4.0` 已发布，`latest = 0.4.0`，shasum `bb25ca414ce8fb909544107e2a0fdb9aadeb9a8e`，8 个文件 / 355 KB。
- 本地 `web` profile 已从 `link:` 切到 registry 版：依赖写的是 `"0.4.0"`，`bundles` 里有 `dsh-raindrop-plugin`。
- 环境：node 25.9、npm 11.21.1（`npm stage` 需要 ≥ 11.15）。

---

## 0. 三分钟版（熟手直接看这里）

```bash
# 1. 改版本号
npm version patch --no-git-tag-version

# 2. 自检
npm pack --dry-run
npm publish --dry-run

# 3. 发布（2FA 账号必须带 OTP）
npm publish --otp=123456

# 4. 如果 latest 变成 0.0.0-stage，说明进了暂存发布，去批准
npm stage list dsh-raindrop-plugin
npm stage approve <stage-id> --otp=654321

# 5. 验证 + 装到 profile
npm view dsh-raindrop-plugin version
dsh plugin --profile web add dsh-raindrop-plugin@<新版本>

# 6. 收尾
git tag -a v<新版本> -m "dsh-raindrop-plugin <新版本>"
git push origin v<新版本>
```

---

## 1. 发布前检查

- [ ] `version` 已 bump，且这个版本号没发过：`npm view dsh-raindrop-plugin versions --json`
- [ ] 产物清单正确（应为 8 个文件，`lib/`、`docs/preview.png`、`cordis.patch.yml`、两个 README、LICENSE）：

      ```bash
      npm pack --dry-run
      ```

- [ ] 两个入口语法没问题（`prepublishOnly` 也会跑一遍）：

      ```bash
      node --check lib/index.js && node --check lib/client.js
      ```

- [ ] 工作区干净：`git status --short`
- [ ] README 里的功能/安装说明与本次改动一致（npm 页面直接渲染 `README.md`）
- [ ] 如果要长期兼容新版 DSH，确认 `engines.dsh` 仍然成立

> 版本号习惯：修 bug 走 patch（0.4.1），加功能走 minor（0.5.0）。已发布的版本号**永远不能复用**。

## 2. 认证

两种方式，选一种。

### A. 网页登录（简单，但发布时要给 OTP）

```bash
npm login
npm whoami
```

### B. Granular token 勾 Bypass 2FA（可免 OTP，适合频繁发布）

npmjs.com → 头像 → Access Tokens → Generate New Token → **Granular Access Token**：

- `Packages and scopes` → **Read and write** → All packages
- **勾上 `Bypass two-factor authentication (2FA)`** ← 少勾这个就是 403
- 生成后：

  ```bash
  npm config set //registry.npmjs.org/:_authToken=npm_xxxx
  npm whoami
  ```

注意：

- 只有写权限、没勾 bypass，发布仍会被拒（写权限 ≠ 免 2FA）。
- token 只写本机 `~/.npmrc`（权限 600），**绝不提交、绝不贴到聊天/截图**。泄露就 Delete 后重建。
- 按时效性：bypass-2FA 的 granular token 预计 **2027 年 1 月**起不能再直接发布，长期自动化转 trusted publishing（OIDC）。

## 3. 发布

```bash
npm publish --otp=123456      # 用认证器 App 的 6 位码，30 秒内敲完
```

- 成功：打印 `+ dsh-raindrop-plugin@x.y.z`。
- 用 bypass token 时可省掉 `--otp`。
- `--otp` 与 token 类型无关，是最通用的方式。

## 4. 暂存发布（staged publishing）—— 第一次就踩过

npm 在 2FA / 新包场景下会把「上传」和「证明人在场」拆开：先给包名建一个 **`0.0.0-stage` 占位包**，真正的版本进 staging，等人批准后才变成 `latest`。

**怎么判断进了暂存：**

```bash
npm view dsh-raindrop-plugin version        # 显示 0.0.0-stage
npm view dsh-raindrop-plugin time --json    # 0.0.0-stage 的创建时间就是发布那一刻
npm stage list dsh-raindrop-plugin         # 列出待批准的 stage
```

占位包只有 2 个文件、341 B，**不是你的代码**；`pnpm` 装它会报 `ERR_PNPM_TARBALL_EXTRACT`，这不是包坏了，是装错了东西。

**批准：**

```bash
npm stage list                          # 不带参数列出你所有的 stage
npm stage view <stage-id>               # 看清楚版本和文件
npm stage approve <stage-id> --otp=654321
npm stage reject  <stage-id>            # 放弃这次
```

批准后 `npm view dsh-raindrop-plugin version` 应该变成目标版本。如果 `npm stage list` 显示没有待批，而 `latest` 已是目标版本，说明已经发布成功，不需要再做任何事。

**缓存陷阱**（真实踩过）：占位包上线到正式版上线之间有一两分钟窗口，此期间 `npm view` 和 pnpm 都可能拿旧元数据，看到/装到 `0.0.0-stage`。强制刷新：

```bash
npm view dsh-raindrop-plugin version --prefer-online
```

## 5. 验证发布内容

```bash
npm view dsh-raindrop-plugin@<版本> dist.shasum dist.fileCount
```

和本地打包的 shasum 对比，**必须完全一致**：

```bash
npm pack --json --dry-run | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s)[0].shasum))'
```

顺手确认关键元数据没丢：

```bash
npm view dsh-raindrop-plugin@<版本> engines dsh.bundle dsh.client
```

> 注意：这个对比要在**发布时的同一份工作区**上做。发布之后又改了 README/代码，shasum 自然就不同了，那是预期行为，不是发布出错。

## 6. 装到 DSH profile

```bash
# 从 link 切到 registry（如果之前是 link:）
dsh plugin --profile web remove dsh-raindrop-plugin

# 钉版本安装，避免 latest 缓存歧义
dsh plugin --profile web add dsh-raindrop-plugin@<版本>
```

验证四项：

```bash
grep -A1 '"dependencies"' ~/.dsh/profiles/web/package.json   # 依赖值是 "x.y.z"
grep '"dsh-raindrop-plugin"' ~/.dsh/profiles/web/package.json # bundles 里有它
ls -ld ~/.dsh/profiles/web/node_modules/dsh-raindrop-plugin   # 真目录，不是 -> Desktop/... 软链
grep -c "0.0.0-stage" ~/.dsh/profiles/web/pnpm-lock.yaml      # 应为 0
```

然后刷新浏览器页面，侧栏日期和搜索框应正常。

如果 pnpm 仍顽固解析到 `0.0.0-stage`（元数据缓存），加 `--force` 重跑：

```bash
dsh plugin --profile web add dsh-raindrop-plugin@<版本> --force
```

## 7. 收尾

```bash
git tag -a v<版本> -m "dsh-raindrop-plugin <版本>"
git push origin v<版本>

# 可选：把占位版本标记为废弃，避免有人误装
npm deprecate dsh-raindrop-plugin@0.0.0-stage "staged publish placeholder"
```

## 8. 故障速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required` | 账号 2FA 是 “authorization and writes”，凭据不豁免写操作 | `npm publish --otp=...`，或换成勾了 Bypass 2FA 的 granular token |
| `EOTP` | OTP 缺失/过期 | 换新码重跑 |
| `ECONNRESET`，`request to .../-/v1/login failed` | 到 npm 的链路被中途重置（直连 Cloudflare 常见） | 重试；改用 token 绕开 login；或开代理后配 `npm config set proxy/https-proxy` |
| `EPERM ... ~/.npm/_cacache/tmp`，提示 "root-owned files" | 提示不可信。真正原因是当前 shell 无权写 `~/.npm`（受限沙箱等） | 在自己的终端执行；或 `npm publish --cache /tmp/npm-cache --logs-dir /tmp/npm-logs` |
| `latest` 是 `0.0.0-stage` | 进了暂存发布，还没批准 | `npm stage list` → `npm stage approve <id>` |
| pnpm `ERR_PNPM_TARBALL_EXTRACT` | 装到了 341 B 的占位包 | 等正式版上线后钉版本重装；`grep 0.0.0-stage pnpm-lock.yaml` 确认 |
| `EPUBLISHCONFLICT` / 版本已存在 | 同版本号重发 | 改 `version` |
| `402 Payment Required` | 免费账号只能发 public | unscoped 默认 public，别加 `--access restricted` |
| `E404` on publish | 名字被占 / 无权限 | 换名或改 scoped 名 `@用户名/xxx` + `--access public` |
| `npm stage` 不存在 | npm < 11.15 | `npm install -g npm@11.21.1` |

## 9. 发错了怎么办

- **刚发几分钟**：`npm unpublish dsh-raindrop-plugin@<版本>`（72 小时内、且没有其他包依赖它时才允许）。
- **超过 72 小时**：不能删，只能 `npm deprecate dsh-raindrop-plugin@<版本> "原因"`，然后发一个修好的新版本。
- 无论哪种，**已发布的版本号都不能再用来重发**。

## 10. 可选：CI 自动发布

公开仓库 + GitHub Actions：

```yaml
permissions:
  id-token: write     # trusted publishing / provenance
  contents: read
# npm publish --provenance --access public
```

- 用 OIDC trusted publishing 可以完全不用 token。
- 不配 provenance 也能发，只是 npm 页面不会有 “Built and signed on GitHub Actions” 徽章。

## 11. 安全提醒

- `~/.npmrc` 里的 token 等同于账号发布权限，泄露立即 revoke 并重建。
- 不要把 token 写进仓库里的 `.npmrc`；CI 用 secret。
- 2FA 建议保持开启；如果嫌每次输码麻烦，用勾了 Bypass 2FA 的 token，但注意第 2 节里的 2027-01 时限。
