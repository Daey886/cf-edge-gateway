import { handleEmail } from "./email.js";
import { handleHttp } from "./http.js";

export default {
  // 邮件路由入口 (Cloudflare Email Routing)
  async email(message, env, ctx) {
    try {
      if (env && env.ENABLE_EMAIL_SHIELD !== false) {
        return await handleEmail(message, env, ctx);
      }
    } catch (err) {
      console.error("[Email Handler Fatal Error]:", err.stack || err);
      message.setReject("550 5.7.0 Internal Mail Processing Error");
    }
  },

  // HTTP 请求网关入口 (健康检查、反代、Webhook)
  async fetch(request, env, ctx) {
    try {
      if (env && env.ENABLE_HTTP_PROXY !== false) {
        return await handleHttp(request, env, ctx);
      }
      return new Response("HTTP Gateway Disabled", { status: 403 });
    } catch (err) {
      console.error("[HTTP Handler Fatal Error]:", err.stack || err);
      return new Response(JSON.stringify({
        error: "Internal Server Error",
        message: err.message
      }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
  }
};
