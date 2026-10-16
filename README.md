# Cloudflare Edge Gateway (cf-edge-gateway)

一款轻量、高性能且易于扩展的 Cloudflare Workers 边缘邮件安全网关：
- **邮件防轰炸 (Anti-Bombing / Flood Protection)**：支持自定义滑动窗口频控（时间窗口内允许最大重复数量），防单发件人狂刷与瞬时全网散列接口注册轰炸。
- **品牌名称仿冒防钓鱼 (Display Name Spoofing)**：智能嗅探显示名称是否伪装成 Apple/Google/Microsoft/银行/交易所，如发信域不符直接 550 拒信阻断。
- **高危恶意附件拦截 (Dangerous Attachments Guard)**：边缘嗅探 `.exe`、`.scr`、`.bat`、`.vbs`、`.ps1`、`.iso` 等可执行文件与双重扩展名。
- **超大邮件体积防御 (Payload Size Guard)**：支持自定义体积上限（默认 25MB），防止利用巨型载荷实施边缘资源耗尽攻击。
- **安全事件实时 Webhook 告警 (Security Webhook)**：遭遇高危攻击或洪水轰炸时，自动异步推送至飞书、Bark、Telegram 或自建告警服务。
- **三级智能分流 (3-Tier Triage)**：正常邮件安全直达收件箱，营销广告邮件注入标头并自动分流至隔离邮箱（如 Gmail `+spam` 别名或指定分类邮箱）。
- **无感热更新**：通过 GitHub Actions 实现提交即部署，支持在 GitHub 后台随时修改分流邮箱与安全策略变量。

---

## 目录结构

```text
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions 自动构建与发布流水线
├── src/
│   ├── rules/
│   │   └── spam.js         # 规则库（防轰炸阈值、钓鱼品牌库、危险扩展名、垃圾词库、黑名单）
│   ├── email.js            # 邮件路由与纵深安全防御核心 (防轰炸/防钓鱼/防附件/拒信/分流/直达)
│   ├── http.js             # HTTP 边缘反代与健康探针
│   └── index.js            # Workers 主调度入口
├── wrangler.toml           # Cloudflare 配置文件
└── package.json
```

---

## 纵深防御机制 (Deep Defense Pipeline)

1. **体积超限熔断 (Payload Guard)**：超过设定阈值（默认 25MB）直接 552 拒信。
2. **L0 级防轰炸 (Flood Protection)**：
   * **发件人频控**：同发件人在设定时间段内超过阈值（默认：**60秒内最多 3 封**），判定为恶意刷屏，直接 550 拒信并触发安全告警。
   * **收件人瞬时洪峰**：单收件人在设定时间段内涌入超过阈值（默认：**60秒内最多 20 封**），自动触发降级隔离，全部导入分流箱，不打爆主收件箱。
3. **L1 级硬拦截 (Hard Block)**：
   * **发件人黑名单**：预置或自定义恶意发件人直接 550 拒信。
   * **SPF/DKIM/DMARC 严格验真**：伪造发件人未通过签名者直接 550 拒信。
   * **显示名称钓鱼仿冒检测**：自称知名企业/金融机构但发件域名不匹配直接 550 拒信。
   * **恶意可执行附件过滤**：包含 `.exe`、`.bat`、`.vbs`、`.iso` 等危险扩展名直接 550 拒信。
   * **欺诈高危关键词**：违法发票、博彩、高利贷等直接 550 拒信。
4. **L2 级软分流 (Soft Triage)**：推广促销词汇打上 `X-Spam-Status: Yes` 标头，分流至隔离邮箱。
5. **L3 级安全放行 (Safe Inbox)**：验真完全合格直达主收件箱。

---

## 快速上手与配置指南

### 1. 配置 GitHub Actions 密钥与变量
进入你的 GitHub 仓库 -> **Settings -> Secrets and variables -> Actions**：

#### ① 必填密钥 (Secrets)
| 变量名 | 说明 |
| :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | 具备 Edit Cloudflare Workers 权限的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Cloudflare Account ID |

#### ② 转发与分流邮箱 (Variables 变量 或 Secrets 密钥)
| 变量名 | 示例值 | 说明 |
| :--- | :--- | :--- |
| `FORWARD_DEFAULT_EMAIL` | `your-inbox@example.com` | **主收件箱**：通过安全验真后的正常邮件 |
| `FORWARD_SPAM_EMAIL` | `your-inbox+spam@example.com` | **隔离邮箱**：命中营销/广告词的分流邮件 |

#### ③ [可选] 高级安全与告警配置 (Variables 变量) — **不设置则自动使用安全默认值**
| 变量名 | 默认值 | 作用说明 |
| :--- | :--- | :--- |
| `FLOOD_SENDER_WINDOW_SECONDS` | `60` | 单发件人频控的计算时间窗口（单位：秒） |
| `FLOOD_SENDER_MAX_COUNT` | `3` | 该时间窗口内允许的最大邮件数（超过即 550 拒信） |
| `FLOOD_RECIPIENT_WINDOW_SECONDS`| `60` | 单收件人洪峰计算时间窗口（单位：秒） |
| `FLOOD_RECIPIENT_MAX_COUNT` | `20` | 该时间窗口内允许的最大邮件数（超过转入分流隔离箱） |
| `MAX_EMAIL_SIZE_MB` | `25` | 邮件体积上限（超过即 552 拒信） |
| `ALERT_WEBHOOK_URL` | *(空)* | 安全事件 Webhook 推送地址（支持飞书/Bark/Telegram 等） |

---

### 2. 在 Cloudflare Email Routing 中绑定 Worker
1. 登录 Cloudflare 控制台 -> 选择你的域名 -> **Email Routing（电子邮件路由）**。
2. 确保在 **Destination addresses** 中已验证通过上述目标接收邮箱。
3. 进入 **Routing rules（路由规则）** -> 点击 **Create rule**：
   * **Custom address**：填写你的域名邮箱（例如 `i@yourdomain.com`）。
   * **Action**：选择 **Send to a Worker**。
   * **Destination**：选择已部署的 **`cf-edge-gateway`**。

---

## 开源协议
MIT License
