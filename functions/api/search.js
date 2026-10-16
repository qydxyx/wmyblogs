import { handleSearch } from "../../server/api.mjs";

export function onRequest(context) {
  return handleSearch(context.request, context.env);
}
