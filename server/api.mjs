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

async function upstreamPost(url, key, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...bearer(key)
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 280) || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(data.error?.message || data.error || data.detail || `HTTP ${res.status}`);
  }
  return data;
}

async function embedTexts(env, inputs) {
  const data = await upstreamPost(envValue(env, "EMBED_URL"), envValue(env, "EMBED_KEY"), {
    model: envValue(env, "EMBED_MODEL"),
    input: inputs
  });
  const list = data.data || data.embeddings || [];
  if (!list.length) throw new Error("embedding 没有返回向量");
  return list
    .map((row) => ({ index: row.index ?? 0, vec: row.embedding || row }))
    .sort((a, b) => a.index - b.index)
    .map((r) => r.vec);
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

export async function handleConfig(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (request.method !== "GET") return json({ error: "GET only" }, 405);
  return json(describeConfig(env));
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
      temperature: 0.15
    });
    const choice = data.choices && data.choices[0];
    const text = choice?.message?.content || choice?.text || data.output_text || data.content || "";
    if (!text) return json({ error: "聊天模型没有返回文字" }, 502);
    return json({ text: String(text) });
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}

export async function handleApi(request, env = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/config") return handleConfig(request, env);
  if (path === "/api/refine") return handleRefine(request, env);
  if (path === "/api/chat") return handleChat(request, env);
  return json({ error: "not found" }, 404);
}
