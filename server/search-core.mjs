import * as OpenCC from "opencc-js";

export const BASES = [
  "https://wmyblog.site/search",
  "https://cdn.jsdelivr.net/gh/taizihuang/wmyblog@main/search",
  "https://raw.githubusercontent.com/taizihuang/wmyblog/main/search",
  "https://cdn.jsdmirror.cn/gh/taizihuang/wmyblog@main/search"
];

export const FILES = [
  ["article", "正文"],
  ["annotation", "后注"],
  ["comment", "问答"],
  ["transcript", "访谈"]
];

export const INDEX_SCHEMA = 4;

const toCN = OpenCC.Converter({ from: "tw", to: "cn" });
const toTW = OpenCC.Converter({ from: "cn", to: "tw" });

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
const WORD = /[a-z0-9]/i;

export function tokenize(text) {
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

export function strip(html) {
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

export function dateKey(s) {
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

export function docsFrom(kind, payload) {
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
        body: passageOf(body, 900),
        extra: String(item.tag || ""),
        passage: passageOf(body, 900),
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
        body: passageOf(body, 900),
        extra: String(item.tag || ""),
        passage: passageOf(body, 900),
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
        body: passageOf(body, 900),
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
        body: passageOf(body, 900),
        extra: String(item.tag || ""),
        passage: passageOf(body, 900),
        weight: 0.55
      });
    });
  }
  return out;
}

export function stampOf(payloads) {
  return FILES.map(([file], i) => {
    const arr = (payloads[i] && payloads[i][file]) || [];
    const first = arr[0] || {};
    const last = arr[arr.length - 1] || {};
    return [
      file,
      arr.length,
      dateKey(first.date || first.reply_date),
      dateKey(last.date || last.reply_date)
    ].join(":");
  }).join("|");
}

export async function fetchJson(name, fetchFn = fetch) {
  let last = "";
  for (const base of BASES) {
    try {
      const res = await fetchFn(`${base}/${name}.json`, { cache: "no-cache" });
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

export async function fetchAllPayloads(fetchFn = fetch) {
  const payloads = [];
  for (const [file] of FILES) payloads.push(await fetchJson(file, fetchFn));
  return payloads;
}

export function docsAndCounts(payloads) {
  const all = [];
  const counts = { article: 0, note: 0, qa: 0, talk: 0 };
  FILES.forEach(([file], i) => {
    const docs = docsFrom(file, payloads[i] || {});
    all.push(...docs);
    if (file === "article") counts.article = docs.length;
    if (file === "annotation") counts.note = docs.length;
    if (file === "comment") counts.qa = docs.length;
    if (file === "transcript") counts.talk = docs.length;
  });
  return { all, counts, total: all.length };
}

export function slimDocs(docs) {
  return docs.map((d) => {
    const extra = String(d.extra || "");
    const row = {
      id: d.id,
      kind: d.kind,
      title: d.title,
      date: d.date,
      url: d.url,
      passage: d.passage,
      weight: d.weight
    };
    if (extra) row.extra = extra;
    return row;
  });
}

const STOP = new Set(
  "的了是在有和与或及以于對对為为這这那哪個个們们你我他她它就都也還还很不沒没嗎吗呢吧啊把被讓让給给到從从上下中大小來来去過过著着與與無无麼么嗎嗎及及其所被能會会要可而於於並并但卻却只又或與與什麼什么爲什麽为什么是不是如何怎么怎麼為何为何"
);

function recency(date) {
  if (!date) return 1;
  const y = Number(date.slice(0, 4));
  if (!y) return 1;
  return 1 + Math.max(0, Math.min(1, (y - 2014) / 12)) * 0.25;
}

function isStop(t) {
  return !t || STOP.has(t);
}

function bigrams(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].length === 1 && tokens[i + 1].length === 1) {
      const g = tokens[i] + tokens[i + 1];
      if (isStop(tokens[i]) && isStop(tokens[i + 1])) continue;
      out.push(g);
    }
  }
  return out;
}

function phrasesOf(raw) {
  const q = String(raw || "")
    .toLowerCase()
    .replace(/[？?！!，,。.\s]+/g, "");
  const stripped = q.replace(/为什么|爲什麽|是不是|如何|怎么|怎麼|為何|为何|吗|嗎|呢|啊/g, "");
  const out = [];
  if (q.length >= 2) out.push(q);
  if (stripped.length >= 2 && stripped !== q) out.push(stripped);
  return out;
}

function queryVariants(raw) {
  const a = String(raw || "").trim();
  return [...new Set([a, toTW(a), toCN(a)].filter(Boolean))];
}

export function searchDocs(docs, query, kinds, limit) {
  if (!docs || !docs.length) return [];
  const want = new Set(kinds && kinds.length ? kinds : ["article", "note", "qa", "talk"]);
  const raw = String(query || "").trim();
  if (!raw) return [];
  const variants = queryVariants(raw);
  const tokenSets = variants.map(tokenize);
  const tokens = [...new Set(tokenSets.flat())];
  if (!tokens.length) return [];
  const grams = [...new Set(tokenSets.flatMap(bigrams))];
  const words = tokens.filter((t) => t.length > 1);
  const chars = tokens.filter((t) => t.length === 1 && !isStop(t));
  const phrases = [...new Set(variants.flatMap(phrasesOf))];
  const needKey = grams.length + words.length;
  const scored = [];
  for (const d of docs) {
    if (!want.has(d.kind)) continue;
    const title = String(d.title || "").toLowerCase();
    const hay = `${title}\n${d.passage || ""}\n${d.extra || ""}`.toLowerCase();
    let score = 0;
    let keys = 0;
    for (const p of phrases) {
      if (title.includes(p)) score += 18;
      else if (hay.includes(p)) score += 10;
    }
    for (const w of words) {
      if (title.includes(w)) {
        keys++;
        score += 6;
      } else if (hay.includes(w)) {
        keys++;
        score += 3.2;
      }
    }
    for (const g of grams) {
      if (title.includes(g)) {
        keys++;
        score += 5;
      } else if (hay.includes(g)) {
        keys++;
        score += 2.6;
      }
    }
    if (needKey && !keys) continue;
    let charHits = 0;
    for (const c of chars) {
      if (hay.includes(c)) charHits++;
    }
    if (!needKey && !charHits) continue;
    score += charHits * 0.25;
    score *= (d.weight || 1) * recency(d.date);
    if (needKey) score *= 0.55 + keys / needKey;
    scored.push({
      id: d.id,
      kind: d.kind,
      title: d.title,
      date: d.date,
      url: d.url,
      passage: d.passage,
      score
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit || 24);
}
