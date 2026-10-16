import { SpamRules } from "./rules/spam.js";

/**
 * 邮件分级防御与智能分流核心模块 (开源规范版)
 * 
 * 分级策略：
 * - L1 高危恶意 (Hard Block)：黑名单、SPF/DMARC伪造、诈骗博彩词 -> 550 拒信
 * - L2 疑似营销/垃圾 (Soft Triage)：推广营销词 -> 注入 X-Spam-Status 标头并支持分流到隔离邮箱
 * - L3 安全邮件 (Safe Inbox)：正常放行 -> 注入安全审计标头后直达主收件箱
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
