import { handleConfig } from "../server/api.mjs";

export const config = { runtime: "edge" };

export default function handler(request) {
  return handleConfig(request, process.env);
}
