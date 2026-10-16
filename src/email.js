import { SpamRules } from "./rules/spam.js";

// 边缘内存级滑动窗口频率计数器 (Worker 隔离区常驻内存)
const rateLimitCache = new Map();

/**
 * 频率限制校验辅助函数
 * @param {string} key 统计键 (如 sender:xxx@yyy.com 或 recipient:i@baey.top)
 * @param {number} windowSec 滑动窗口时长(秒)
 * @param {number} maxLimit 最大允许邮件数
 * @returns {boolean} true: 超过频率限制; false: 正常未超限
 */
function isRateLimited(key, windowSec, maxLimit) {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  
  let timestamps = rateLimitCache.get(key) || [];
  // 过滤掉窗口期之外的历史记录
  timestamps = timestamps.filter(t => now - t < windowMs);
  
  if (timestamps.length >= maxLimit) {
    return true;
  }
  
  timestamps.push(now);
  rateLimitCache.set(key, timestamps);

  // 定期轻量修剪缓存防膨胀
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
 * 邮件分级防御、智能分流与防轰炸核心模块
 */
export async function handleEmail(message, env, ctx) {
  const from = (message.from || "").toLowerCase();
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
  // 【L0 级别：防邮件轰炸 / 洪水攻击拦截 (Flood Protection)】
  // ==========================================
  const floodConfig = SpamRules.floodProtection || {};
  const senderLimit = floodConfig.senderRateLimit || { windowSeconds: 60, maxCount: 3 };
  const recipientLimit = floodConfig.recipientRateLimit || { windowSeconds: 60, maxCount: 20 };

  // 1. 单发件人突发频控：防脚本狂刷同发件人轰炸
  if (isRateLimited(`from:${from}`, senderLimit.windowSeconds, senderLimit.maxCount)) {
    console.warn(`[防轰炸拦截] 发件人 ${from} 在 ${senderLimit.windowSeconds}s 内超过 ${senderLimit.maxCount} 封限制，予以拒信拦截`);
    message.setReject("550 5.7.0 Rate limit exceeded. Too many emails sent in a short period.");
    return;
  }

  // 2. 单收件人洪峰频控：防全网短信/注册接口散列轰炸 (如数千个不同网站同时发验证码)
  if (isRateLimited(`to:${to}`, recipientLimit.windowSeconds, recipientLimit.maxCount)) {
    console.warn(`[防轰炸分流] 收件人 ${to} 瞬间收到大量邮件 (超过 ${recipientLimit.maxCount} 封/分)，自动降级拦截/分流隔离`);
    
    // 洪峰期自动分流到垃圾隔离箱，并加上轰炸警报头，不打爆主收件箱
    const floodHeaders = new Headers();
    floodHeaders.set("X-Spam-Status", "Yes");
    floodHeaders.set("X-Spam-Reason", "Flood-Protection-Triggered");
    floodHeaders.set("X-Processed-By", "cf-edge-gateway-anti-flood");

    try {
      await message.forward(spamDestEmail, floodHeaders);
    } catch (e) {
      console.error(`[防轰炸隔离异常]: ${e.message}`);
    }
    return;
  }

  // ==========================================
  // 【L1 级别：高危恶意直接拒信】
  // ==========================================

  // 1. 发件人黑名单
  if (SpamRules.blockedSenders.some(blocked => from.includes(blocked.toLowerCase()))) {
    console.warn(`[L1 拒信] 命中黑名单发件人: ${from}`);
    message.setReject("550 5.7.1 Sender is blocked by domain security policy.");
    return;
  }

  // 2. SPF / DKIM / DMARC 欺诈仿冒拦截
  if (authResults.includes("spf=fail") || authResults.includes("dmarc=fail")) {
    console.warn(`[L1 拒信] 伪造发件人未通过 SPF/DMARC: ${from}`);
    message.setReject("550 5.7.2 Email authentication (SPF/DMARC) failed.");
    return;
  }

  // 3. 极度危险诈骗词（违规发票、博彩、高利贷）
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
    console.log(`[L3 正常放行] 安全送达: ${from} -> ${primaryEmail}`);
  } catch (err) {
    console.error(`[L3 转发异常]: ${err.message}`);
  }
}
