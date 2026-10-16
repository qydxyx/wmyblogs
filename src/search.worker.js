import MiniSearch from "minisearch";

const BASES = [
  "https://wmyblog.site/search",
  "https://cdn.jsdelivr.net/gh/taizihuang/wmyblog@main/search",
  "https://raw.githubusercontent.com/taizihuang/wmyblog/main/search",
  "https://cdn.jsdmirror.cn/gh/taizihuang/wmyblog@main/search"
];

const FILES = [
  ["article", "正文"],
  ["annotation", "后注"],
  ["comment", "问答"],
  ["transcript", "访谈"]
];

let mini;
let toCN = (s) => s;
let toTW = (s) => s;
let ready = false;

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const WORD = /[a-z0-9]/i;

function tokenize(text) {
  const chars = [...String(text || "").toLowerCase()];
  const tokens = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      tokens.push(buf);
      buf = "";
    }
  };
  for (const c of chars) {
    if (CJK.test(c)) {
      flush();
      tokens.push(c);
    } else if (WORD.test(c)) {
      buf += c;
    } else {
      flush();
    }
  }
  flush();
  return tokens;
}

function strip(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function dateKey(s) {
  const d = String(s || "").replace(/\//g, "-").slice(0, 10);
  if (!d || d === "NaT" || d === "None") return "";
  return d;
}

function href(id, md5) {
  const file = String(id || "").replace(/^\/+/, "");
  const hash = md5 ? "#" + md5 : "";
  return `https://wmyblog.site/html/${file}.html${hash}`;
}

function passageOf(text, n = 1400) {
  const t = String(text || "");
  return t.length > n ? t.slice(0, n) : t;
}

async function loadOpenCC() {
  try {
    const OpenCC = await import("opencc-js");
    toCN = OpenCC.Converter({ from: "tw", to: "cn" });
    toTW = OpenCC.Converter({ from: "cn", to: "tw" });
  } catch {
    toCN = (s) => s;
    toTW = (s) => s;
  }
}

async function fetchJson(name) {
  let last = "";
  for (const base of BASES) {
    try {
      const res = await fetch(`${base}/${name}.json`, { cache: "no-cache" });
      if (!res.ok) {
        last = String(res.status);
        continue;
      }
      return await res.json();
    } catch (err) {
      last = String(err && err.message ? err.message : err);
    }
  }
  throw new Error(`${name} 读取失败 ${last}`);
}

function docsFrom(kind, payload) {
  const out = [];
  if (kind === "article") {
    (payload.article || []).forEach((item, i) => {
      const body = strip(item.content);
      if (!body) return;
      out.push({
        id: "article-" + (item.md5 || item.id) + "-" + i,
        kind: "article",
        title: strip(item.title) || "正文",
        date: dateKey(item.date),
        url: href(item.id, item.md5),
        body: passageOf(body, 3200),
        extra: String(item.tag || ""),
        passage: passageOf(body),
        weight: 1
      });
    });
  } else if (kind === "annotation") {
    (payload.annotation || []).forEach((item, i) => {
      const body = strip(item.content);
      if (!body) return;
      out.push({
        id: "note-" + (item.md5 || item.id) + "-" + i,
        kind: "note",
        title: strip(item.title) || "后注",
        date: dateKey(item.date),
        url: href(item.id, item.md5),
        body: passageOf(body, 3200),
        extra: String(item.tag || ""),
        passage: passageOf(body),
        weight: 1.55
      });
    });
  } else if (kind === "comment") {
    (payload.comment || []).forEach((item, i) => {
      const reply = strip(item.reply);
      if (!reply) return;
      const ask = strip(item.comment);
      const body = `问：${ask}\n答：${reply}`;
      const when = dateKey(item.reply_date) || dateKey(item.date);
      out.push({
        id: "qa-" + (item.md5 || item.id) + "-" + i,
        kind: "qa",
        title: strip(item.nickname) || "问答",
        date: when,
        url: href(item.id, item.md5),
        body: passageOf(body, 3200),
        extra: String(item.tag || ""),
        passage: passageOf(body, 1600),
        weight: 1.35
      });
    });
  } else if (kind === "transcript") {
    (payload.transcript || []).forEach((item, i) => {
      const body = strip(item.content);
      if (!body) return;
      out.push({
        id: "talk-" + (item.md5 || item.id) + "-" + i,
        kind: "talk",
        title: strip(item.title) || "访谈",
        date: dateKey(item.date),
        url: href(item.id, item.md5),
        body: passageOf(body, 3200),
        extra: String(item.tag || ""),
        passage: passageOf(body),
        weight: 0.55
      });
    });
  }
  return out;
}

function recency(date) {
  if (!date) return 1;
  const y = Number(date.slice(0, 4));
  if (!y) return 1;
  return 1 + Math.max(0, Math.min(1, (y - 2014) / 12)) * 0.25;
}

async function build() {
  const all = [];
  const counts = { article: 0, note: 0, qa: 0, talk: 0 };
  for (const [file, label] of FILES) {
    postMessage({ type: "progress", message: `正在读取${label}` });
    const payload = await fetchJson(file);
    const docs = docsFrom(file, payload);
    all.push(...docs);
    if (file === "article") counts.article = docs.length;
    if (file === "annotation") counts.note = docs.length;
    if (file === "comment") counts.qa = docs.length;
    if (file === "transcript") counts.talk = docs.length;
  }
  postMessage({ type: "progress", message: `正在建立索引 ${all.length} 条` });
  mini = new MiniSearch({
    fields: ["title", "body", "extra"],
    storeFields: ["kind", "title", "date", "url", "passage", "weight"],
    idField: "id",
    tokenize,
    processTerm: (t) => t,
    searchOptions: {
      tokenize,
      processTerm: (t) => t,
      boost: { title: 2.2, body: 1, extra: 0.35 },
      fuzzy: 0,
      prefix: false,
      combineWith: "OR"
    }
  });
  const chunk = 500;
  for (let i = 0; i < all.length; i += chunk) {
    mini.addAll(all.slice(i, i + chunk));
    postMessage({
      type: "progress",
      message: `正在建立索引 ${Math.min(i + chunk, all.length)} / ${all.length}`
    });
  }
  ready = true;
  postMessage({ type: "ready", counts, total: all.length });
  loadOpenCC().catch(() => {});
}

function search(query, kinds, limit) {
  if (!mini) return [];
  const want = new Set(kinds && kinds.length ? kinds : ["article", "note", "qa", "talk"]);
  const raw = String(query || "").trim();
  if (!raw) return [];
  const variants = [...new Set([raw, toCN(raw), toTW(raw)].filter((s) => s && s.trim()))];
  const merged = new Map();
  for (const q of variants) {
    let hits = [];
    try {
      hits = mini.search(q, {
        filter: (doc) => want.has(doc.kind)
      });
    } catch {
      hits = [];
    }
    if (!hits.length && tokenize(q).length > 1) {
      try {
        hits = mini.search(q, {
          filter: (doc) => want.has(doc.kind)
        });
      } catch {
        hits = [];
      }
    }
    for (const h of hits) {
      const prev = merged.get(h.id);
      if (!prev || h.score > prev.score) merged.set(h.id, h);
    }
  }
  const ranked = [...merged.values()]
    .map((h) => {
      const score = h.score * (h.weight || 1) * recency(h.date);
      return {
        id: h.id,
        kind: h.kind,
        title: h.title,
        date: h.date,
        url: h.url,
        passage: h.passage,
        score
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit || 24);
  return ranked;
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === "start") {
    try {
      await build();
    } catch (err) {
      postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
    }
    return;
  }
  if (msg.type === "search") {
    if (!ready) {
      postMessage({ type: "results", req: msg.req, hits: [], pending: true });
      return;
    }
    const hits = search(msg.query, msg.kinds, msg.limit);
    postMessage({ type: "results", req: msg.req, hits });
  }
};
