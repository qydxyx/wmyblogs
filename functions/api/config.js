import { handleConfig } from "../../server/api.mjs";

export function onRequest(context) {
  return handleConfig(context.request, context.env);
}
