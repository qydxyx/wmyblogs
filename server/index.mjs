import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { handleNode } from "./node.mjs";
import { loadDotenv } from "./env.mjs";

loadDotenv();

const root = resolve(process.env.STATIC_DIR || "dist");
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://local");
  if (url.pathname.startsWith("/api/")) {
    await handleNode(req, res, process.env);
    return;
  }

  let path = decodeURIComponent(url.pathname);
  if (path === "/") path = "/index.html";
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) {
    res.statusCode = 403;
    res.end("forbidden");
    return;
  }
  try {
    const st = await stat(file);
    if (st.isDirectory()) {
      res.statusCode = 302;
      res.setHeader("location", path.endsWith("/") ? path + "index.html" : path + "/");
      res.end();
      return;
    }
    const data = await readFile(file);
    res.setHeader("content-type", types[extname(file)] || "application/octet-stream");
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(root, "index.html"));
      res.statusCode = 200;
      res.setHeader("content-type", types[".html"]);
      res.end(data);
    } catch {
      res.statusCode = 404;
      res.end("not found");
    }
  }
});

server.listen(port, () => {
  console.log(`houzhu on http://localhost:${port}`);
});
