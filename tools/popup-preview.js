"use strict";

// Development fixture only: the shipped popup always uses the real Chrome API.
globalThis.chrome = {
  runtime: {
    async sendMessage(message) {
      if (message.type !== "CODEMENTOR_HEALTH") return { ok: false, error: "Unsupported preview message." };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        const data = await response.json();
        return response.ok ? { ok: true, data } : { ok: false, error: data.detail || "Cannot reach the local backend." };
      } catch {
        return { ok: false, error: "Cannot reach the local backend." };
      } finally {
        clearTimeout(timer);
      }
    }
  },
  tabs: {
    async query() { return [{ id: 1, url: "https://leetcode.com/problems/two-sum/" }]; },
    async sendMessage(id, message) {
      if (id !== 1 || message.type !== "CODEMENTOR_OPEN") return { ok: false };
      window.top.location.href = "/problems/two-sum/";
      return { ok: true };
    },
    async create() { window.top.location.href = "/problems/two-sum/"; }
  }
};
