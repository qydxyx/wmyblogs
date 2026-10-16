import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  INDEX_SCHEMA,
  docsAndCounts,
  fetchAllPayloads,
  slimDocs,
  stampOf
} from "../server/search-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public");

const payloads = await fetchAllPayloads();
const { all, counts, total } = docsAndCounts(payloads);
console.log("docs", total, counts);
const raw = Buffer.from(JSON.stringify(slimDocs(all)));
const gz = gzipSync(raw, { level: 9 });
await mkdir(outDir, { recursive: true });
const meta = {
  schema: INDEX_SCHEMA,
  stamp: stampOf(payloads),
  counts,
  total,
  builtAt: new Date().toISOString()
};
await writeFile(join(outDir, "search-index.json.gz"), gz);
await writeFile(join(outDir, "search-meta.json"), JSON.stringify(meta));
try {
  await unlink(join(outDir, "search-index.json"));
} catch {
  /* none */
}
console.log("gz bytes", gz.length, "raw", raw.length, "meta", meta);
