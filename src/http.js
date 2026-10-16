/**
 * HTTP 边缘代理与网关处理模块
 * 预留能力：反向代理、API 请求前置过滤、Webhook 分发、自定义鉴权
 */
export async function handleHttp(request, env, ctx) {
  const url = new URL(request.url);

  // 1. 基础健康检查与服务标识
  if (url.pathname === "/health" || url.pathname === "/") {
    return new Response(JSON.stringify({
      status: "online",
      service: "Cloudflare Edge Gateway",
      capabilities: ["email_shield", "http_proxy", "spam_filter", "webhook_router"],
      timestamp: new Date().toISOString()
    }), {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }

  // 2. 边缘反向代理转发示例 (通过 /proxy?url=https://...)
  if (url.pathname.startsWith("/proxy")) {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response("Missing target url parameter: ?url=https://...", { status: 400 });
    }

    try {
      const target = new URL(targetUrl);
      const newHeaders = new Headers(request.headers);
      newHeaders.set("Host", target.hostname);
      
      const modifiedRequest = new Request(target.toString(), {
        method: request.method,
        headers: newHeaders,
        body: request.body,
        redirect: "follow"
      });

      return await fetch(modifiedRequest);
    } catch (err) {
      return new Response(`Proxy Error: ${err.message}`, { status: 502 });
    }
  }

  return new Response("Not Found", { status: 404 });
}
