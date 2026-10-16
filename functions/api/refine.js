import { handleRefine } from "../../server/api.mjs";

export function onRequest(context) {
  return handleRefine(context.request, context.env);
}
