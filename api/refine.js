import { handleRefine } from "../server/api.mjs";

export const config = { runtime: "edge" };

export default function handler(request) {
  return handleRefine(request, process.env);
}
