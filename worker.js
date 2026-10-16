import { handleApi } from "./server/api.mjs";

export default {
  async fetch(request, env) {
    return handleApi(request, env);
  }
};
