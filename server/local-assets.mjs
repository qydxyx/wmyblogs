import { readFile } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";

export function localAssets() {
  const roots = [...new Set([
    resolve(process.env.STATIC_DIR || "dist"),
    resolve("public"),
    resolve("dist")
  ])];
  return {
    async fetch(request) {
      const url = typeof request === "string" ? new URL(request) : new URL(request.url);
      let path = decodeURIComponent(url.pathname);
      if (path === "/") path = "/index.html";
      for (const base of roots) {
        const file = normalize(join(base, path));
        if (!file.startsWith(base)) continue;
        try {
          const data = await readFile(file);
          const gz = path.endsWith(".gz");
          return new Response(data, {
            headers: { "content-type": gz ? "application/gzip" : "application/octet-stream" }
          });
        } catch {
          /* try next root */
        }
      }
      return new Response("not found", { status: 404 });
    }
  };
}
