import { SpamRules } from "./rules/spam.js";

/**
 * 邮件防御与过滤核心模块
 */
export async function handleEmail(message, env, ctx) {
  const from = (message.from || "").toLowerCase();
  const to = (message.to || "").toLowerCase();
  const subject = (message.headers.get("subject") || "").toLowerCase();
  const authResults = (message.headers.get("authentication-results") || "").toLowerCase();

  // 1. 发件人黑名单检测
  if (SpamRules.blockedSenders.some(blocked => from.includes(blocked.toLowerCase()))) {
    console.warn(`[Blocked] 黑名单发件人拦截: ${from}`);
    if (SpamRules.defaultAction === "reject") {
      message.setReject("550 5.7.1 Message rejected by recipient security policy.");
    }
    return;
  }

  // 2. SPF / DKIM / DMARC 仿冒拦截
  if (authResults.includes("spf=fail") || authResults.includes("dmarc=fail")) {
    console.warn(`[Blocked] 伪造未通过 SPF/DMARC: ${from}`);
    if (SpamRules.defaultAction === "reject") {
      message.setReject("550 5.7.2 Authentication check failed.");
    }
    return;
  }

  // 3. 垃圾关键词过滤
  const hitKeyword = SpamRules.spamKeywords.find(kw => subject.includes(kw.toLowerCase()));
  if (hitKeyword) {
    console.warn(`[Blocked] 触发垃圾关键词 [${hitKeyword}]: ${subject}`);
    if (SpamRules.defaultAction === "reject") {
      message.setReject("550 5.7.0 Spam content detected.");
    }
    return;
  }

  // 4. 白名单/正常邮件放行与路由转发
  const targetEmail = env.FORWARD_DEFAULT_EMAIL || "admin@example.com";
  try {
    await message.forward(targetEmail);
    console.log(`[Forwarded] 邮件已安全转发至: ${targetEmail} | 来源: ${from}`);
  } catch (err) {
    console.error(`[Forward Error]: ${err.message}`);
  }
}
