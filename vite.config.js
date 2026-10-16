import { defineConfig } from "vite";
import { handleNode } from "./server/node.mjs";
import { loadDotenv } from "./server/env.mjs";

loadDotenv();

function apiDevPlugin() {
  return {
    name: "houzhu-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || "").split("?")[0];
        if (!path.startsWith("/api/")) return next();
        handleNode(req, res, process.env).catch((err) => {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: String(err.message || err) }));
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [apiDevPlugin()],
  publicDir: "public",
  worker: { format: "es" },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0
  }
});
