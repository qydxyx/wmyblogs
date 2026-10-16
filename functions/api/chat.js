import { handleChat } from "../../server/api.mjs";

export function onRequest(context) {
  return handleChat(context.request, context.env);
}
