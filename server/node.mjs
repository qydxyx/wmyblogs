import { handleApi } from "./api.mjs";

export async function handleNode(req, res, env) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const host = req.headers.host || "local";
  const request = new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks)
  });
  const out = await handleApi(request, env);
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await out.arrayBuffer()));
}
