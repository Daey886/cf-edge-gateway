import { SpamRules } from "./rules/spam.js";

// 边缘内存级滑动窗口频率计数器 (Worker 隔离区常驻内存)
const rateLimitCache = new Map();

/**
 * 频率限制校验辅助函数
 */
function isRateLimited(key, windowSec, maxLimit) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  
  let timestamps = rateLimitCache.get(key) || [];
  timestamps = timestamps.filter(t => now - t < windowMs);
  
  if (timestamps.length >= maxLimit) {
    return true;
  }
  
  timestamps.push(now);
  rateLimitCache.set(key, timestamps);

  if (rateLimitCache.size > 2000) {
    for (const [k, v] of rateLimitCache.entries()) {
      if (v.length === 0 || now - v[v.length - 1] > 300000) {
        rateLimitCache.delete(k);
      }
    }
  }

  return false;
}

/**
 * 安全解析正整数环境变量
 */
function parseEnvInt(val, defaultVal) {
  if (!val) return defaultVal;
  const n = parseInt(val, 10);
  return (!isNaN(n) && n > 0) ? n : defaultVal;
}

/**
 * 提取发件人邮箱中的域名部分
 */
function extractDomain(emailStr) {
  const match = (emailStr || "").match(/@([a-zA-Z0-9.\-_]+)/);
  return match ? match[1].toLowerCase() : "";
}

/**
 * 异步发送安全告警 Webhook (支持飞书、Bark、Telegram 或通用 JSON 接收端)
 */
async function sendSecurityAlert(env, ctx, alertData) {
  const webhookUrl = env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const title = `🛡️ [边缘网关安全警报] ${alertData.type}`;
  const textContent = `时间: ${new Date().toISOString()}\n收件人: ${alertData.to}\n发件人: ${alertData.from}\n原因: ${alertData.reason}\n处理动作: ${alertData.action}`;

  let payload;
  if (webhookUrl.includes("feishu.cn") || webhookUrl.includes("larksuite.com")) {
    payload = {
      msg_type: "text",
      content: { text: `${title}\n${textContent}` }
    };
  } else if (webhookUrl.includes("day.app") || webhookUrl.includes("bark")) {
    payload = {
      title: title,
      body: textContent,
      group: "Security",
      level: "critical"
    };
  } else {
    payload = {
      event: "security_alert",
      title: title,
      ...alertData,
      timestamp: Date.now()
    };
  }

  const alertPromise = fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(err => {
    console.error("[Security Webhook Error]:", err.message);
  });

  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(alertPromise);
  }
}

/**
 * 邮件分级防御、智能分流、防轰炸、防钓鱼与恶意附件防护核心模块
 */
export async function handleEmail(message, env, ctx) {
  const fromRaw = message.headers.get("from") || message.from || "";
  const fromEmail = (message.from || "").toLowerCase();
  const to = (message.to || "").toLowerCase();
  const subject = (message.headers.get("subject") || "").toLowerCase();
  const authResults = (message.headers.get("authentication-results") || "").toLowerCase();

  const primaryEmail = env.FORWARD_DEFAULT_EMAIL;
  const spamDestEmail = env.FORWARD_SPAM_EMAIL || primaryEmail;

  if (!primaryEmail) {
    console.error("[Config Error] 未配置 FORWARD_DEFAULT_EMAIL 目标邮箱，拒绝转发");
    message.setReject("550 5.7.1 Destination forwarding address is not configured.");
    return;
  }

  // ==========================================
  // 【超大邮件体积防御 (Max Raw Size Guard)】
  // ==========================================
  const maxMb = parseEnvInt(env.MAX_EMAIL_SIZE_MB, 25);
  const maxBytes = maxMb * 1024 * 1024;
  if (message.rawSize && message.rawSize > maxBytes) {
    console.warn(`[体积超限拦截] 邮件大小 ${(message.rawSize / 1024 / 1024).toFixed(2)}MB 超过限制 ${maxMb}MB`);
    message.setReject(`552 5.3.4 Message size exceeds fixed maximum limit (${maxMb}MB).`);
    return;
  }

  // ==========================================
  // 【L0 级别：防邮件轰炸 / 洪水攻击拦截 (支持自定义频控)】
  // ==========================================
  const floodDefault = SpamRules.floodProtection || {};
  const defaultSender = floodDefault.senderRateLimit || { windowSeconds: 60, maxCount: 3 };
  const defaultRecipient = floodDefault.recipientRateLimit || { windowSeconds: 60, maxCount: 20 };

  const senderWindowSec = parseEnvInt(env.FLOOD_SENDER_WINDOW_SECONDS, defaultSender.windowSeconds);
  const senderMaxCount = parseEnvInt(env.FLOOD_SENDER_MAX_COUNT, defaultSender.maxCount);
  const recipientWindowSec = parseEnvInt(env.FLOOD_RECIPIENT_WINDOW_SECONDS, defaultRecipient.windowSeconds);
  const recipientMaxCount = parseEnvInt(env.FLOOD_RECIPIENT_MAX_COUNT, defaultRecipient.maxCount);

  // 1. 单发件人突发频控
  if (isRateLimited(`from:${fromEmail}`, senderWindowSec, senderMaxCount)) {
    console.warn(`[防轰炸拦截] 发件人 ${fromEmail} 在 ${senderWindowSec}s 内超过 ${senderMaxCount} 封限制`);
    sendSecurityAlert(env, ctx, {
      type: "发件人频控轰炸拦截",
      from: fromEmail,
      to: to,
      reason: `${senderWindowSec}s 内发送超过 ${senderMaxCount} 封`,
      action: "550 拒信阻断"
    });
    message.setReject(`550 5.7.0 Rate limit exceeded: max ${senderMaxCount} emails per ${senderWindowSec}s.`);
    return;
  }

  // 2. 单收件人洪峰频控
  if (isRateLimited(`to:${to}`, recipientWindowSec, recipientMaxCount)) {
    console.warn(`[防轰炸分流] 收件人 ${to} 在 ${recipientWindowSec}s 内涌入超过 ${recipientMaxCount} 封`);
    sendSecurityAlert(env, ctx, {
      type: "收件人散列洪峰告警",
      from: fromEmail,
      to: to,
      reason: `单收件人瞬时涌入超过 ${recipientMaxCount} 封`,
      action: "降级隔离至垃圾箱"
    });

    const floodHeaders = new Headers();
    floodHeaders.set("X-Spam-Status", "Yes");
    floodHeaders.set("X-Spam-Reason", `Flood-Protection-Triggered-${recipientMaxCount}-per-${recipientWindowSec}s`);
    floodHeaders.set("X-Processed-By", "cf-edge-gateway-anti-flood");

    try {
      await message.forward(spamDestEmail, floodHeaders);
    } catch (e) {
      console.error(`[防轰炸隔离异常]: ${e.message}`);
    }
    return;
  }

  // ==========================================
  // 【L1 级别：高危欺诈、钓鱼仿冒与恶意文件拦截】
  // ==========================================

  // 1. 发件人黑名单
  if (SpamRules.blockedSenders.some(blocked => fromEmail.includes(blocked.toLowerCase()))) {
    console.warn(`[L1 拒信] 命中黑名单发件人: ${fromEmail}`);
    message.setReject("550 5.7.1 Sender is blocked by domain security policy.");
    return;
  }

  // 2. SPF / DKIM / DMARC 欺诈仿冒拦截
  if (authResults.includes("spf=fail") || authResults.includes("dmarc=fail")) {
    console.warn(`[L1 拒信] 伪造发件人未通过 SPF/DMARC: ${fromEmail}`);
    sendSecurityAlert(env, ctx, {
      type: "邮件伪造验证失败",
      from: fromEmail,
      to: to,
      reason: "SPF/DMARC 签名验证失败 (spf=fail / dmarc=fail)",
      action: "550 拒信阻断"
    });
    message.setReject("550 5.7.2 Email authentication (SPF/DMARC) failed.");
    return;
  }

  // 3. 防发件人显示名称仿冒钓鱼 (Display Name Spoofing)
  const fromDisplayLower = fromRaw.toLowerCase();
  const senderDomain = extractDomain(fromEmail);
  for (const rule of (SpamRules.brandSpoofing || [])) {
    const hitBrand = rule.keywords.some(kw => fromDisplayLower.includes(kw.toLowerCase()));
    if (hitBrand) {
      const isDomainValid = rule.validDomains.some(vd => senderDomain === vd || senderDomain.endsWith("." + vd));
      if (!isDomainValid) {
        console.warn(`[防钓鱼拦截] 显示名称仿冒: "${fromRaw}" 真实域名 "${senderDomain}" 不在官方授权白名单中`);
        sendSecurityAlert(env, ctx, {
          type: "知名品牌显示名称钓鱼仿冒",
          from: fromRaw,
          to: to,
          reason: `发件人声称来自品牌机构，但实际发信域为 ${senderDomain}`,
          action: "550 拒信阻断"
        });
        message.setReject("550 5.7.1 Phishing attempt detected: Display name brand mismatch.");
        return;
      }
    }
  }

  // 4. 恶意可执行附件嗅探拦截 (Dangerous Attachments Guard)
  const mimeHeadersStr = (message.headers.get("content-disposition") || "") + " " +
                         (message.headers.get("content-type") || "");
  const hitDangerousExt = (SpamRules.dangerousExtensions || []).find(ext => {
    const re = new RegExp(`filename=[^;]*\\${ext}["']?`, "i");
    return re.test(mimeHeadersStr) || mimeHeadersStr.toLowerCase().includes(ext);
  });
  if (hitDangerousExt) {
    console.warn(`[恶意附件拦截] 检测到高危可执行文件载荷: ${hitDangerousExt}`);
    sendSecurityAlert(env, ctx, {
      type: "恶意可执行文件附件拦截",
      from: fromEmail,
      to: to,
      reason: `邮件携带高危后缀附件: ${hitDangerousExt}`,
      action: "550 拒信阻断"
    });
    message.setReject(`550 5.7.0 Dangerous attachment detected (${hitDangerousExt}).`);
    return;
  }

  // 5. 极度危险诈骗词（违规发票、博彩、高利贷）
  const hitHighRisk = SpamRules.highRiskKeywords.find(kw => subject.includes(kw.toLowerCase()));
  if (hitHighRisk) {
    console.warn(`[L1 拒信] 命中高危恶意关键词 [${hitHighRisk}]: ${subject}`);
    message.setReject("550 5.7.0 High-risk spam or fraudulent content rejected.");
    return;
  }

  // ==========================================
  // 【L2 级别：疑似营销 / 垃圾软分流】
  // ==========================================
  const hitMarketing = SpamRules.marketingKeywords.find(kw => subject.includes(kw.toLowerCase()));
  if (hitMarketing) {
    console.warn(`[L2 分流] 命中疑似营销词 [${hitMarketing}]: ${subject}`);

    const customHeaders = new Headers();
    customHeaders.set("X-Spam-Status", "Yes");
    customHeaders.set("X-Spam-Reason", `Keyword-${encodeURIComponent(hitMarketing)}`);
    customHeaders.set("X-Processed-By", "cf-edge-gateway-l2");

    try {
      await message.forward(spamDestEmail, customHeaders);
      console.log(`[L2 分流成功] 已转发至隔离邮箱: ${spamDestEmail}`);
    } catch (err) {
      console.error(`[L2 分流异常]: ${err.message}`);
    }
    return;
  }

  // ==========================================
  // 【L3 级别：白名单与正常邮件安全直达】
  // ==========================================
  const safeHeaders = new Headers();
  safeHeaders.set("X-Spam-Status", "No");
  safeHeaders.set("X-Shield-Security", "Passed");
  safeHeaders.set("X-Processed-By", "cf-edge-gateway-l3");

  try {
    await message.forward(primaryEmail, safeHeaders);
    console.log(`[L3 正常放行] 安全送达: ${fromEmail} -> ${primaryEmail}`);
  } catch (err) {
    console.error(`[L3 转发异常]: ${err.message}`);
  }
}
