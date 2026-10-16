import { handleEmail } from "./email.js";
import { handleHttp } from "./http.js";

export default {
  // 邮件路由入口 (Cloudflare Email Routing)
  async email(message, env, ctx) {
    if (env.ENABLE_EMAIL_SHIELD !== false) {
      return await handleEmail(message, env, ctx);
    }
  },

  // HTTP 请求网关入口 (反代、过滤、Webhook)
  async fetch(request, env, ctx) {
    if (env.ENABLE_HTTP_PROXY !== false) {
      return await handleHttp(request, env, ctx);
    }
    return new Response("HTTP Gateway Disabled", { status: 403 });
  }
};
