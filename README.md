# Cloudflare Edge Gateway (cf-edge-gateway)

基于 Cloudflare Workers 的多功能边缘网关架构，预留高度可扩展模块：
- **邮件安全防御 (Email Shield)**：发件人黑名单、SPF/DMARC 伪造验证、垃圾关键词精准拦截、邮件静默丢弃/拒信。
- **代理过滤与转发 (HTTP Proxy)**：边缘请求过滤、反向代理、自定义请求头修改。
- **扩展预留**：支持后续追加 Webhook 事件分发、速率限制 (Rate Limit)、动态 KV/D1 规则库等能力。

---

## 目录结构

```text
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions 自动构建与发布流水线
├── src/
│   ├── rules/
│   │   └── spam.js         # 独立抽离的垃圾关键词与黑名单规则库
│   ├── email.js            # 邮件路由与安全防御逻辑
│   ├── http.js             # HTTP 边缘反代与请求过滤器
│   └── index.js            # Workers 主调度入口
├── wrangler.toml           # Cloudflare 配置文件
└── package.json
```

---

## 部署与配置

### 1. 配置 GitHub Secrets
在 GitHub 仓库中进入 **Settings -> Secrets and variables -> Actions**，添加：
- `CLOUDFLARE_API_TOKEN`：具备 Worker 编辑权限的 API Token
- `CLOUDFLARE_ACCOUNT_ID`：你的 Cloudflare 账户 ID

### 2. Cloudflare Email Routing 绑定
1. 进入 Cloudflare 仪表盘 -> 域名 -> **Email Routing**。
2. 添加规则：选择收件地址，操作选择 **Send to a Worker**，目标选择 `cf-edge-gateway`。
