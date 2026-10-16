import { ensureIndex, peekMeta, runSearch } from "./search-runtime.mjs";

const REQUIRED = [
  ["EMBED_URL", "EMBED_MODEL", "EMBED_KEY"],
  ["CHAT_URL", "CHAT_MODEL", "CHAT_KEY"]
];

export function envValue(env, key) {
  if (env && env[key] != null && String(env[key]).trim()) return String(env[key]).trim();
  try {
    if (typeof process !== "undefined" && process.env && process.env[key]) {
      const v = String(process.env[key]).trim();
      if (v) return v;
    }
  } catch {
    /* no process */
  }
  return "";
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS"
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors() }
  });
}

function bearer(key) {
  if (!key) return {};
  return { authorization: key.startsWith("Bearer ") ? key : `Bearer ${key}` };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function upstreamError(status, data, raw) {
  const err = data && data.error;
  if (typeof err === "string" && err.trim()) return err.trim();
  if (err && typeof err === "object") {
    const msg = err.message || err.status || err.code;
    if (msg) return String(msg);
  }
  if (data && data.detail) return String(data.detail);
  const snippet = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (snippet) return snippet;
  if (status === 429) return "模型限流，请稍后再试";
  if (status === 503 || status === 529) return "模型繁忙，请稍后再试";
  return `HTTP ${status}`;
}

function retryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
}

function missingOf(env, keys) {
  return keys.filter((k) => !envValue(env, k));
}

export function describeConfig(env) {
  const embedMissing = missingOf(env, REQUIRED[0]);
  const chatMissing = missingOf(env, REQUIRED[1]);
  const rrKeys = ["RERANK_URL", "RERANK_MODEL", "RERANK_KEY"];
  const rrMissing = missingOf(env, rrKeys);
  const rerank = rrMissing.length === 0;
  return {
    embed: embedMissing.length === 0,
    chat: chatMissing.length === 0,
    rerank,
    ready: embedMissing.length === 0 && chatMissing.length === 0,
    embedModel: envValue(env, "EMBED_MODEL"),
    chatModel: envValue(env, "CHAT_MODEL"),
    rerankModel: rerank ? envValue(env, "RERANK_MODEL") : "",
    missing: [...embedMissing, ...chatMissing]
  };
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / ((Math.sqrt(na) || 1) * (Math.sqrt(nb) || 1));
}

async function upstreamPost(url, key, body, attempts = 4) {
  let last = "upstream failed";
  for (let i = 0; i < attempts; i++) {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...bearer(key)
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      last = String(err.message || err);
      if (i === attempts - 1) throw new Error(last);
      await sleep(400 * 2 ** i);
      continue;
    }
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
    if (res.ok) return data;
    last = upstreamError(res.status, data, text);
    if (!retryableStatus(res.status) || i === attempts - 1) throw new Error(last);
    let wait = 400 * 2 ** i;
    const ra = Number(res.headers.get("retry-after"));
    if (Number.isFinite(ra) && ra > 0) wait = Math.min(8000, ra * 1000);
    await sleep(wait);
  }
  throw new Error(last);
}

async function embedChunk(env, inputs) {
  const data = await upstreamPost(envValue(env, "EMBED_URL"), envValue(env, "EMBED_KEY"), {
    model: envValue(env, "EMBED_MODEL"),
    input: inputs
  });
  const list = data.data || data.embeddings || [];
  if (!list.length) throw new Error("embedding 没有返回向量");
  const vecs = new Array(inputs.length);
  list.forEach((row, i) => {
    const idx = Number.isInteger(row.index) ? row.index : i;
    const vec = row.embedding || row.values || row;
    if (idx >= 0 && idx < vecs.length) vecs[idx] = vec;
  });
  if (vecs.some((v) => !v)) throw new Error("embedding 向量条数不够");
  return vecs;
}

async function embedTexts(env, inputs) {
  const out = [];
  const size = 8;
  for (let i = 0; i < inputs.length; i += size) {
    const part = await embedChunk(env, inputs.slice(i, i + size));
    out.push(...part);
  }
  return out;
}

async function rerankDocs(env, query, documents) {
  const data = await upstreamPost(envValue(env, "RERANK_URL"), envValue(env, "RERANK_KEY"), {
    model: envValue(env, "RERANK_MODEL"),
    query,
    documents,
    top_n: documents.length
  });
  const rows = data.results || data.data || [];
  if (!rows.length) throw new Error("rerank 没有返回结果");
  return rows.map((row) => ({
    index: row.index ?? row.document_index ?? 0,
    score: row.relevance_score ?? row.score ?? 0
  }));
}

export async function handleConfig(request, env, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (request.method !== "GET") return json({ error: "GET only" }, 405);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(ensureIndex(env).catch(() => {}));
  }
  let index = peekMeta();
  if (!index) {
    try {
      const res = await env.ASSETS.fetch(new Request("http://assets/search-meta.json"));
      if (res.ok) index = await res.json();
    } catch {
      index = null;
    }
  }
  return json({ ...describeConfig(env), index: index || { total: 0, counts: {} } });
}

export async function handleSearch(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const query = String(payload.query || "").trim();
  if (!query) return json({ error: "需要 query" }, 400);
  const kinds = Array.isArray(payload.kinds) ? payload.kinds : [];
  const limit = Math.min(40, Number(payload.limit) || 28);
  try {
    await ensureIndex(env);
    const hits = runSearch(query, kinds, limit);
    return json({ hits, total: (peekMeta() && peekMeta().total) || hits.length });
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}

export async function handleRefine(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const cfg = describeConfig(env);
  if (!cfg.embed) return json({ error: "embedding 未配置", missing: cfg.missing }, 503);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const query = String(payload.query || "").trim();
  const documents = Array.isArray(payload.documents) ? payload.documents.slice(0, 40) : [];
  if (!query || !documents.length) return json({ error: "需要 query 和 documents" }, 400);
  const texts = documents.map((d) => String(d).slice(0, 1200));
  try {
    const vecs = await embedTexts(env, [query, ...texts]);
    const qv = vecs[0];
    let ranked = texts.map((text, i) => ({
      index: i,
      score: cosine(qv, vecs[i + 1] || [])
    }));
    ranked.sort((a, b) => b.score - a.score);
    if (cfg.rerank) {
      const orderedTexts = ranked.map((r) => texts[r.index]);
      const rows = await rerankDocs(env, query, orderedTexts);
      const byPos = new Map(rows.map((r) => [r.index, r.score]));
      ranked = ranked
        .map((r, pos) => ({ index: r.index, score: (byPos.get(pos) ?? 0) + r.score * 0.05 }))
        .sort((a, b) => b.score - a.score);
    }
    return json({ order: ranked.map((r) => r.index), rerank: cfg.rerank });
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}

export async function handleChat(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const cfg = describeConfig(env);
  if (!cfg.chat) return json({ error: "聊天模型未配置", missing: cfg.missing }, 503);
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(0, 8) : [];
  if (!messages.length) return json({ error: "需要 messages" }, 400);
  try {
    const data = await upstreamPost(envValue(env, "CHAT_URL"), envValue(env, "CHAT_KEY"), {
      model: envValue(env, "CHAT_MODEL"),
      messages,
      temperature: 0.15,
      max_tokens: 900
    });
    const choice = data.choices && data.choices[0];
    const text = choice?.message?.content || choice?.text || data.output_text || data.content || "";
    if (!text) return json({ error: "聊天模型没有返回文字" }, 502);
    return json({ text: String(text) });
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}

export async function handleApi(request, env = {}, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/config") return handleConfig(request, env, ctx);
  if (path === "/api/search") return handleSearch(request, env);
  if (path === "/api/refine") return handleRefine(request, env);
  if (path === "/api/chat") return handleChat(request, env);
  return json({ error: "not found" }, 404);
}
