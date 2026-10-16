import { handleApi } from "./server/api.mjs";
import { ensureIndex, refreshLiveIndex } from "./server/search-runtime.mjs";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      ctx.waitUntil(ensureIndex(env).catch(() => {}));
      return env.ASSETS.fetch(request);
    }
    return handleApi(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshLiveIndex().catch(() => {}));
  }
};
