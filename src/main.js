const KIND_LABEL = {
  article: "正文",
  note: "后注",
  qa: "问答",
  talk: "访谈"
};

let serverConfig = { ready: false, embed: false, chat: false, rerank: false, index: { total: 0, counts: {} } };

async function searchIndex(query, kinds, limit = 28) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, kinds, limit })
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error || `search ${res.status}`);
  return Array.isArray(data.hits) ? data.hits : [];
}

function friendlyError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/503|529|overloaded|unavailable|繁忙/i.test(msg)) return "模型现在忙，再问一次即可。";
  if (/429|rate limit|resource.?exhausted|限流/i.test(msg)) return "模型限流，稍等再问。";
  return msg;
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

function scriptHint(query) {
  const t = String(query || "");
  const tw = (t.match(/[為這國對後發會說經與無麼嗎東車門開關時長來過還個樣點現體業發]/g) || []).length;
  const cn = (t.match(/[为这国对后发会说经与无么吗东车门开关时长来过还个样点现体业]/g) || []).length;
  return tw > cn ? "繁體中文" : "简体中文";
}

function appendInline(node, text) {
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) node.append(text.slice(last, m.index));
    const strong = document.createElement("strong");
    strong.textContent = m[1];
    node.append(strong);
    last = m.index + m[0].length;
  }
  if (last < text.length) node.append(text.slice(last));
}

function fillBlock(el, text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return;
  const parts = raw.split(/\s+[-–]\s+/);
  if (el.tagName === "LI" && parts.length > 1 && parts[0].length <= 60) {
    appendInline(el, parts[0].replace(/[:：]\s*$/, ""));
    const sub = document.createElement("ul");
    parts.slice(1).forEach((bit) => {
      const t = bit.replace(/^[-–]\s*/, "").trim();
      if (!t) return;
      const li = document.createElement("li");
      appendInline(li, t);
      sub.append(li);
    });
    if (sub.childNodes.length) el.append(sub);
    return;
  }
  appendInline(el, raw);
}

function renderAnswer(root, text, hits) {
  root.hidden = false;
  root.replaceChildren();
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .map((l) => l.replace(/^\s+/, ""));

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }
    const ordered = line.match(/^(\d+)[\.、\)]\s+(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (ordered || bullet) {
      const list = document.createElement(ordered ? "ol" : "ul");
      if (ordered) list.start = Number(ordered[1]);
      while (i < lines.length) {
        const L = lines[i];
        const m = ordered ? L.match(/^(\d+)[\.、\)]\s+(.*)$/) : L.match(/^[-*•]\s+(.*)$/);
        if (!m) break;
        const li = document.createElement("li");
        fillBlock(li, m[2] || m[1]);
        list.append(li);
        i++;
      }
      root.append(list);
      continue;
    }
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i] &&
      !/^(\d+)[\.、\)]\s+/.test(lines[i]) &&
      !/^[-*•]\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    const p = document.createElement("p");
    fillBlock(p, buf.join(" "));
    root.append(p);
  }

  if (hits.length) {
    const list = document.createElement("p");
    list.className = "cites";
    list.append("出处：");
    hits.slice(0, 6).forEach((hit, i) => {
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
    .slice(0, 6)
    .map((h, i) => {
      const body = String(h.passage || "").slice(0, 900);
      return `〔${i + 1}〕${KIND_LABEL[h.kind] || h.kind} ${h.date || ""} ${h.title}\n${body}\n${h.url}`;
    })
    .join("\n\n");
  const script = scriptHint(query);
  return [
    {
      role: "system",
      content:
        "你是「后注」的作答器。只根据用户给出的摘录写。摘录来自王孟源博客镜像（正文、后注、作者回复、访谈）。后注和较新的作者回复优先于旧正文；冲突时写明日期并采用较新者。不要编造摘录里没有的事实。句末用〔1〕〔2〕标出处。摘录不够就直说档案没写到。全文用" +
        script +
        "。写短段，像杂志专栏。不要星号加粗、不要井号标题、不要代码块。不要「根据摘录」「主要包括以下几个方面」这类套话。先用两三句把结论说完，再分段讲因果，段与段空一行。"
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
  const head = hits.slice(0, 16);
  const rest = hits.slice(16);
  const documents = head.map((h) => `${h.title}\n${h.passage}`.slice(0, 800));
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
    if (head[i] && !used.has(i)) {
      used.add(i);
      ranked.push(head[i]);
    }
  }
  head.forEach((h, i) => {
    if (!used.has(i)) ranked.push(h);
  });
  return ranked.concat(rest);
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
  if (!serverConfig.ready) {
    setStatus("服务器还没配置 embedding 和聊天模型。词面检索仍可用，先列出命中。");
  }
  const ac = new AbortController();
  form.dataset.busy = "1";
  try {
    setStatus("正在检索。");
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
    try {
      hits = await refineHits(q, hits, ac.signal);
      renderHits(hitsRoot, hits.slice(0, 10));
    } catch (err) {
      setStatus(`对照未完成，仍用词面结果。${friendlyError(err)}`);
    }
    setStatus("正在作答。");
    try {
      const text = await askChat(q, hits, ac.signal);
      renderAnswer(answerRoot, text, hits);
      setStatus(serverConfig.rerank ? "作答完成（含 rerank）。下面是出处。" : "作答完成。下面是出处。");
    } catch (err) {
      setStatus(`作答暂时失败，下面仍是出处。${friendlyError(err)}`);
    }
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
  const index = serverConfig.index || {};
  applyCounts(index.counts || {});
  if (index.total) setStatus(`共 ${index.total} 条，可直接问。`);
  else setStatus("检索在服务器上，可直接问。");
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
