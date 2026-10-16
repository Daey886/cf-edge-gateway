# Cloudflare Edge Gateway (cf-edge-gateway)

一款轻量、高性能且易于扩展的 Cloudflare Workers 边缘网关：
- **邮件防轰炸 (Anti-Bombing / Flood Protection)**：支持在 GitHub 后台完全自定义频控窗口（某时间段内允许最大重复数量），未设置则自动采用智能默认规则。
- **邮件安全防御 (Email Shield)**：发件人黑名单、SPF/DMARC 伪造验证、垃圾关键词精准拦截、邮件 550 拒信。
- **三级智能分流 (3-Tier Triage)**：正常邮件安全直达收件箱，营销广告邮件注入标头并自动分流至隔离邮箱（如 Gmail `+spam` 别名或指定分类邮箱）。
- **代理过滤与转发 (HTTP Proxy)**：边缘请求过滤、反向代理、自定义请求头修改。
- **无感热更新**：通过 GitHub Actions 实现提交即部署，支持在 GitHub 后台随时修改分流邮箱与防轰炸阈值变量。

---

## 目录结构

```text
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions 自动构建与发布流水线
├── src/
│   ├── rules/
│   │   └── spam.js         # 独立抽离的防轰炸默认阈值、垃圾关键词与黑名单规则库
│   ├── email.js            # 邮件路由与安全防御逻辑 (L0防轰炸/L1拒信/L2分流/L3直达)
│   ├── http.js             # HTTP 边缘反代与请求过滤器
│   └── index.js            # Workers 主调度入口
├── wrangler.toml           # Cloudflare 配置文件
└── package.json
```

---

## 防护机制 (Defense Pipeline)

1. **L0 级防轰炸 (Flood Protection)**：
   * **发件人频控**：同发件人在设定时间段内超过阈值（默认：**60秒内最多 3 封**），判定为恶意刷屏，直接 550 拒信。
   * **收件人瞬时洪峰**：单收件人在设定时间段内涌入超过阈值（默认：**60秒内最多 20 封**，常见于全网注册验证码恶意轰炸），自动触发降级隔离，全部导入分流箱，不打爆主收件箱。
2. **L1 级硬拦截 (Hard Block)**：SPF/DMARC 仿冒伪造失败、黑名单发件人、违法欺诈高危词直接拒信。
3. **L2 级软分流 (Soft Triage)**：推广促销词汇打上 `X-Spam-Status: Yes` 标头，分流至隔离邮箱。
4. **L3 级安全放行 (Safe Inbox)**：验真完全合格直达主收件箱。

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
推荐在 **Variables（变量）** 选项卡中添加：
| 变量名 | 示例值 | 说明 |
| :--- | :--- | :--- |
| `FORWARD_DEFAULT_EMAIL` | `your-inbox@example.com` | **主收件箱**：通过安全验真后的正常邮件 |
| `FORWARD_SPAM_EMAIL` | `your-inbox+spam@example.com` | **隔离邮箱**：命中营销/广告词的分流邮件 |

#### ③ [可选] 防轰炸自定义阈值 (Variables 变量) — **不设置则自动使用默认值**
用户可根据自身需求自由定制频率判定，完全免改代码：
| 变量名 | 默认值 | 作用说明 |
| :--- | :--- | :--- |
| `FLOOD_SENDER_WINDOW_SECONDS` | `60` | 单发件人频控的计算时间窗口（单位：秒） |
| `FLOOD_SENDER_MAX_COUNT` | `3` | 该时间窗口内允许的最大邮件数（超过即 550 拒信） |
| `FLOOD_RECIPIENT_WINDOW_SECONDS`| `60` | 单收件人洪峰计算时间窗口（单位：秒） |
| `FLOOD_RECIPIENT_MAX_COUNT` | `20` | 该时间窗口内允许的最大邮件数（超过转入分流隔离箱） |

---

### 2. 在 Cloudflare Email Routing 中绑定 Worker
1. 登录 Cloudflare 控制台 -> 选择你的域名 -> **Email Routing（电子邮件路由）**。
2. 确保在 **Destination addresses** 中已验证通过上述目标接收邮箱。
3. 进入 **Routing rules（路由规则）** -> 点击 **Create rule**：
   * **Custom address**：填写你的域名邮箱（例如 `i@yourdomain.com` 或 `contact@yourdomain.com`）。
   * **Action**：选择 **Send to a Worker**。
   * **Destination**：选择已部署的 **`cf-edge-gateway`**。

---

## 开源协议
MIT License
