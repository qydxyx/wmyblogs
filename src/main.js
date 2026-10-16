const KIND_LABEL = {
  article: "正文",
  note: "后注",
  qa: "问答",
  talk: "访谈"
};

const worker = new Worker(new URL("./search.worker.js", import.meta.url), { type: "module" });
let reqSeq = 0;
const pending = new Map();
let indexReady = false;
let queuedAsk = false;
let serverConfig = { ready: false, embed: false, chat: false, rerank: false };

worker.addEventListener("message", (ev) => {
  const msg = ev.data || {};
  if (msg.type === "progress") {
    setStatus(msg.message);
    return;
  }
  if (msg.type === "ready") {
    indexReady = true;
    setStatus(`索引就绪，共 ${msg.total} 条。`);
    applyCounts(msg.counts || {});
    if (queuedAsk) {
      queuedAsk = false;
      const form = document.getElementById("ask-form");
      if (form && String(new FormData(form).get("q") || "").trim()) runAsk(form);
    }
    return;
  }
  if (msg.type === "error") {
    setStatus(`索引失败：${msg.message}`);
    return;
  }
  if (msg.type === "results") {
    const wait = pending.get(msg.req);
    if (wait) {
      pending.delete(msg.req);
      wait(msg.hits || []);
    }
  }
});

worker.addEventListener("error", (err) => {
  setStatus(`索引线程出错：${err.message || err}`);
});

function searchIndex(query, kinds, limit = 28) {
  const req = ++reqSeq;
  return new Promise((resolve) => {
    pending.set(req, resolve);
    worker.postMessage({ type: "search", req, query, kinds, limit });
  });
}

function setStatus(text) {
  const el = document.getElementById("index-status");
  if (el) el.textContent = text;
}

function applyCounts(counts) {
  const map = {
    article: counts.article,
    note: counts.note,
    qa: counts.qa,
    talk: counts.talk
  };
  for (const [key, n] of Object.entries(map)) {
    if (!n) continue;
    document.querySelectorAll(`[data-key="${key}"] .count`).forEach((el) => {
      el.textContent = String(n);
    });
  }
  const noteEl = document.querySelector(".stats-figure");
  if (counts.note && noteEl) {
    const span = document.createElement("span");
    span.textContent = "条后注";
    noteEl.replaceChildren(String(counts.note), span);
  }
}

function selectedKinds(form) {
  return [...form.querySelectorAll('input[name="type"]:checked')].map((el) => el.value);
}

function snippet(text, n = 180) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

function renderHits(root, hits) {
  root.replaceChildren();
  for (const hit of hits) {
    const art = document.createElement("article");
    art.className = "hit";
    const h = document.createElement("h3");
    const a = document.createElement("a");
    a.className = "link";
    a.href = hit.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = hit.title;
    h.append(a);
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = [KIND_LABEL[hit.kind] || hit.kind, hit.date].filter(Boolean).join(" · ");
    const p = document.createElement("p");
    p.textContent = snippet(hit.passage);
    art.append(h, meta, p);
    root.append(art);
  }
}

function renderAnswer(root, text, hits) {
  root.hidden = false;
  root.replaceChildren();
  const parts = String(text || "").trim().split(/\n{2,}/);
  for (const part of parts) {
    const p = document.createElement("p");
    p.textContent = part;
    root.append(p);
  }
  if (hits.length) {
    const list = document.createElement("p");
    list.append("出处：");
    hits.slice(0, 8).forEach((hit, i) => {
      if (i) list.append(" ");
      const a = document.createElement("a");
      a.href = hit.url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = `〔${i + 1}〕${KIND_LABEL[hit.kind] || ""}`;
      list.append(a);
    });
    root.append(list);
  }
}

function chatMessages(query, hits) {
  const excerpts = hits
    .slice(0, 8)
    .map((h, i) => {
      return `〔${i + 1}〕${KIND_LABEL[h.kind] || h.kind} ${h.date || ""} ${h.title}\n${h.passage}\n${h.url}`;
    })
    .join("\n\n");
  return [
    {
      role: "system",
      content:
        "你是「后注」检索界面的作答器。只根据用户给出的摘录回答。摘录来自王孟源博客镜像（正文、后注、作者回复、访谈转写）。后注和较新的作者回复优先于旧正文。若摘录互相冲突，写明日期并采用较新者。不要编造摘录里没有的事实。关键判断后用〔编号〕标出摘录。若摘录不够，直说档案里没有写到。用与提问相同的中文（简体或繁体）。"
    },
    {
      role: "user",
      content: `问题：${query}\n\n摘录：\n${excerpts}`
    }
  ];
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 280) || `HTTP ${res.status}`);
  }
}

async function refineHits(query, hits, signal) {
  const documents = hits.map((h) => `${h.title}\n${h.passage}`.slice(0, 1200));
  const res = await fetch("/api/refine", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, documents }),
    signal
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || `refine ${res.status}`);
  const order = Array.isArray(data.order) ? data.order : [];
  const used = new Set();
  const ranked = [];
  for (const i of order) {
    if (hits[i] && !used.has(i)) {
      used.add(i);
      ranked.push(hits[i]);
    }
  }
  hits.forEach((h, i) => {
    if (!used.has(i)) ranked.push(h);
  });
  return ranked;
}

async function askChat(query, hits, signal) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: chatMessages(query, hits) }),
    signal
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || `chat ${res.status}`);
  return String(data.text || "");
}

async function runAsk(form) {
  const q = String(new FormData(form).get("q") || "").trim();
  const kinds = selectedKinds(form);
  const hitsRoot = document.getElementById("hits");
  const answerRoot = document.getElementById("answer");
  answerRoot.hidden = true;
  answerRoot.replaceChildren();
  hitsRoot.replaceChildren();
  if (!q) return;
  if (!indexReady) {
    queuedAsk = true;
    setStatus("索引还在建立，就绪后自动检索。");
    return;
  }
  if (!serverConfig.ready) {
    setStatus("服务器还没配置 embedding 和聊天模型。词面检索仍可用，先列出命中。");
  }
  const ac = new AbortController();
  form.dataset.busy = "1";
  try {
    setStatus("正在词面检索。");
    let hits = await searchIndex(q, kinds);
    if (!hits.length) {
      setStatus("没有命中。换个说法，或勾选访谈。");
      return;
    }
    renderHits(hitsRoot, hits.slice(0, 10));
    if (!serverConfig.embed || !serverConfig.chat) {
      setStatus(`检出 ${hits.length} 条。对照和作答需要在服务器写入 EMBED_* 与 CHAT_*。`);
      return;
    }
    setStatus("正在用 embedding 对照。");
    hits = await refineHits(q, hits, ac.signal);
    renderHits(hitsRoot, hits.slice(0, 10));
    setStatus("正在作答。");
    const text = await askChat(q, hits, ac.signal);
    renderAnswer(answerRoot, text, hits);
    setStatus(serverConfig.rerank ? "作答完成（含 rerank）。下面是出处。" : "作答完成。下面是出处。");
  } catch (err) {
    setStatus(String(err.message || err));
  } finally {
    delete form.dataset.busy;
  }
}

function bindAsk() {
  const form = document.getElementById("ask-form");
  if (!form) return;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runAsk(form);
  });
  form.querySelectorAll("[data-q]").forEach((btn) => {
    btn.addEventListener("click", () => {
      form.elements.q.value = btn.getAttribute("data-q") || "";
      runAsk(form);
    });
  });
}

function setModelLine(key, ok, detail) {
  const el = document.querySelector(`[data-model="${key}"] .state`);
  if (!el) return;
  el.textContent = ok ? detail || "已接通" : "未配置";
}

async function loadServerConfig() {
  try {
    const res = await fetch("/api/config");
    serverConfig = await readJson(res);
  } catch {
    serverConfig = { ready: false, embed: false, chat: false, rerank: false };
  }
  setModelLine("embed", serverConfig.embed, serverConfig.embedModel);
  setModelLine("rerank", serverConfig.rerank, serverConfig.rerankModel || "已接通");
  setModelLine("chat", serverConfig.chat, serverConfig.chatModel);
}

function bindArchive() {
  const frame = document.getElementById("archive-frame");
  const list = document.querySelector(".archive-list ul");
  if (!frame || !list) return;
  const photos = [...frame.querySelectorAll(".photo")];
  const rows = [...list.children];
  const show = (key) => {
    photos.forEach((img) => img.classList.toggle("is-on", img.dataset.key === key));
    rows.forEach((li) => li.classList.toggle("is-on", li.dataset.key === key));
  };
  rows.forEach((li) => {
    const key = li.dataset.key;
    li.addEventListener("mouseenter", () => show(key));
    li.addEventListener("focusin", () => show(key));
    li.querySelector("button")?.addEventListener("click", () => show(key));
  });
}

function bindMotion() {
  const targets = document.querySelectorAll("[data-reveal]");
  if (!targets.length) return;
  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => el.classList.add("is-in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
  );
  targets.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) el.classList.add("is-in");
    else io.observe(el);
  });
  window.addEventListener("load", () => {
    targets.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) el.classList.add("is-in");
    });
  });
}

function pauseVideoWhenHidden() {
  const videos = document.querySelectorAll("video[autoplay]");
  if (!videos.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) v.play().catch(() => {});
      else v.pause();
    }
  });
  videos.forEach((v) => io.observe(v));
  document.addEventListener("visibilitychange", () => {
    videos.forEach((v) => {
      if (document.hidden) v.pause();
      else if (v.getBoundingClientRect().bottom > 0 && v.getBoundingClientRect().top < innerHeight) {
        v.play().catch(() => {});
      }
    });
  });
}

bindAsk();
bindArchive();
bindMotion();
pauseVideoWhenHidden();
loadServerConfig();
worker.postMessage({ type: "start" });
