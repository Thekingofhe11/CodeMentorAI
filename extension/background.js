/* Requests originate here so LeetCode never needs access to the local API. */
"use strict";

const BACKEND_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 65000;
const HEALTH_TIMEOUT_MS = 5000;
const ACTIONS = new Set(["chat", "hint", "review", "edge_cases", "solution"]);

function isLeetCodeUrl(value, requireProblem = false) {
  try {
    const url = new URL(value);
    return url.origin === "https://leetcode.com" &&
      (!requireProblem || /^\/problems\/[a-z0-9-]+(?:\/|$)/i.test(url.pathname));
  } catch {
    return false;
  }
}

function trustedSender(sender, requireProblem) {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab) {
    // Chrome can omit tab.url without the tabs permission; sender.url still
    // identifies the originating frame, which must be the top LeetCode frame.
    return sender.frameId === 0 && isLeetCodeUrl(sender.url, requireProblem) &&
      (!sender.tab.url || isLeetCodeUrl(sender.tab.url, requireProblem));
  }
  return !requireProblem && sender.url === chrome.runtime.getURL("popup.html");
}

function validPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const fields = {
    problem_title: 300, problem_slug: 200, problem_url: 1000,
    problem_description: 14000, user_message: 4000
  };
  for (const [field, limit] of Object.entries(fields)) {
    if (typeof payload[field] !== "string" || payload[field].length > limit) return false;
  }
  if (!payload.problem_title.trim() || !payload.problem_slug.trim() ||
      !isLeetCodeUrl(payload.problem_url, true)) return false;
  if (!ACTIONS.has(payload.action) || !Number.isInteger(payload.hint_level) ||
      payload.hint_level < 0 || payload.hint_level > 3) return false;
  if (!Array.isArray(payload.history) || payload.history.length > 12) return false;
  return payload.history.every((message) => message &&
    ["user", "assistant"].includes(message.role) &&
    typeof message.content === "string" && message.content.length <= 4000);
}

function validResponse(data, isHealth) {
  if (!data || !["demo", "ai"].includes(data.mode)) return false;
  if (isHealth) return data.status === "ok";
  return typeof data.reply === "string" && data.reply.trim().length > 0 &&
    data.reply.length <= 12000 && Number.isInteger(data.hint_level) &&
    data.hint_level >= 0 && data.hint_level <= 3;
}

async function handleMessage(message, sender) {
  const isHealth = message.type === "CODEMENTOR_HEALTH";
  if (!trustedSender(sender, !isHealth)) {
    return { ok: false, error: "Open CodeMentor on a LeetCode problem to ask for help." };
  }
  if (!isHealth && !validPayload(message.payload)) {
    return { ok: false, error: "The problem context is incomplete. Refresh the LeetCode page and try again." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), isHealth ? HEALTH_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND_URL}/${isHealth ? "health" : "mentor"}`, {
      method: isHealth ? "GET" : "POST",
      ...(isHealth ? {} : {
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(message.payload)
      }),
      signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error"
    });
    let data;
    try {
      data = await response.json();
    } catch {
      return { ok: false, error: "The backend returned an unreadable response. Check that CodeMentor is running on port 8000." };
    }
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail.slice(0, 300) : "";
      return {
        ok: false,
        error: detail || (response.status === 429
          ? "The mentor is receiving too many requests. Wait a moment and try again."
          : response.status === 422
            ? "The request could not be read. Refresh the problem page and try again."
            : "The mentor could not respond. Check the backend settings and try again.")
      };
    }
    if (!validResponse(data, isHealth)) {
      return { ok: false, error: "The backend response is missing mentor data. Restart the current CodeMentor backend." };
    }
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: controller.signal.aborted || error.name === "AbortError"
        ? "The mentor took too long to respond. Please try again."
        : "Cannot reach CodeMentor. Start the backend on 127.0.0.1:8000, then try again."
    };
  } finally {
    clearTimeout(timeout);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !["CODEMENTOR_REQUEST", "CODEMENTOR_HEALTH"].includes(message.type)) return false;
  handleMessage(message, sender).then(sendResponse, () => {
    sendResponse({ ok: false, error: "CodeMentor could not process the request. Please try again." });
  });
  return true;
});
