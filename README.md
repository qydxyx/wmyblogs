# 后注

王孟源博客的检索前端：正文、后注、作者回复、访谈。语料在运行时从 [taizihuang/wmyblog](https://github.com/taizihuang/wmyblog) / [wmyblog.site](https://wmyblog.site/) 的 search JSON 拉取。

浏览器内 MiniSearch 做词面检索。Embedding 和聊天模型**必须**写在服务器环境变量里；Rerank 可选。页面不收密钥。

## 环境变量

复制 `.env.example` 为 `.env`（本地），或在 Cloudflare / Vercel / Docker 里写入：

| 变量 | 必须 | 说明 |
| --- | --- | --- |
| `EMBED_URL` | 是 | OpenAI 兼容 embeddings 地址 |
| `EMBED_MODEL` | 是 | 型号 |
| `EMBED_KEY` | 是 | 密钥 |
| `CHAT_URL` | 是 | OpenAI 兼容 chat/completions 地址 |
| `CHAT_MODEL` | 是 | 型号 |
| `CHAT_KEY` | 是 | 密钥 |
| `RERANK_URL` | 否 | rerank 地址 |
| `RERANK_MODEL` | 否 | 型号 |
| `RERANK_KEY` | 否 | 密钥；三者都有才启用 rerank |

接口：`GET /api/config`（不返回密钥）、`POST /api/refine`、`POST /api/chat`。

## 本地

```bash
cp .env.example .env
# 填入 EMBED_* 与 CHAT_*
npm install
npm run dev
```

生产预览：

```bash
npm run build
npm start
```

默认 `http://localhost:4173`。`PORT`、`STATIC_DIR` 可改。

## Cloudflare（Workers + 静态资源）

```bash
npm run build
npx wrangler deploy --keep-vars
```

线上默认用 Gemini：`gemini-embedding-001` + `gemini-3.5-flash-lite`。密钥只放 Cloudflare 控制台，部署必须加 `--keep-vars`，否则会清掉控制台里的变量。

部署后在 Cloudflare 控制台写入环境变量，或：

```bash
npx wrangler secret put EMBED_URL
npx wrangler secret put EMBED_MODEL
npx wrangler secret put EMBED_KEY
npx wrangler secret put CHAT_URL
npx wrangler secret put CHAT_MODEL
npx wrangler secret put CHAT_KEY
# 可选
npx wrangler secret put RERANK_URL
npx wrangler secret put RERANK_MODEL
npx wrangler secret put RERANK_KEY
```

`functions/api/` 仍可用于 Cloudflare Pages；本仓库默认用 Workers 部署。

## Vercel

框架 Vite。`api/*.js` 为 Edge Function。在项目 Environment Variables 写入同一组变量。

## Docker

```bash
docker build -t houzhu .
docker run --rm -p 8080:8080 --env-file .env houzhu
```

或 `docker compose up --build`。

## 数据

- `https://wmyblog.site/search/{article,annotation,comment,transcript}.json`

失败时依次试 jsDelivr、GitHub raw、jsdmirror。问答只收录有作者回复的条目。后注权重大于旧正文，访谈低于手写原文。
