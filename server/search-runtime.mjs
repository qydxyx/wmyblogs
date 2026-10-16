import {
  docsAndCounts,
  fetchAllPayloads,
  INDEX_SCHEMA,
  searchDocs,
  slimDocs,
  stampOf
} from "./search-core.mjs";

let docs = null;
let meta = null;
let loading = null;

export function peekMeta() {
  return meta;
}

async function readAsset(env, path) {
  if (!env || !env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    throw new Error("ASSETS missing");
  }
  const res = await env.ASSETS.fetch(new Request("http://assets/" + path.replace(/^\/+/, "")));
  if (!res.ok) throw new Error(path + " " + res.status);
  return res;
}

async function loadFromAssets(env) {
  const gzRes = await readAsset(env, "search-index.json.gz");
  const json = await new Response(gzRes.body.pipeThrough(new DecompressionStream("gzip"))).json();
  if (!Array.isArray(json)) throw new Error("index is not an array");
  let info = { schema: INDEX_SCHEMA, total: json.length, counts: {}, stamp: "", builtAt: "" };
  try {
    const metaRes = await readAsset(env, "search-meta.json");
    info = await metaRes.json();
  } catch {
    /* optional */
  }
  return { docs: json, meta: info };
}

export async function ensureIndex(env) {
  if (docs) return { docs, meta };
  if (!loading) {
    loading = loadFromAssets(env)
      .then((out) => {
        docs = out.docs;
        meta = out.meta;
        return out;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export async function refreshLiveIndex() {
  const payloads = await fetchAllPayloads();
  const stamp = stampOf(payloads);
  if (meta && meta.stamp === stamp && docs) return meta;
  const built = docsAndCounts(payloads);
  docs = slimDocs(built.all);
  meta = {
    schema: INDEX_SCHEMA,
    stamp,
    counts: built.counts,
    total: built.total,
    builtAt: new Date().toISOString()
  };
  return meta;
}

export function runSearch(query, kinds, limit) {
  return searchDocs(docs, query, kinds, limit);
}
