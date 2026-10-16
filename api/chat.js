import { handleChat } from "../server/api.mjs";

export const config = { runtime: "edge" };

export default function handler(request) {
  return handleChat(request, process.env);
}
