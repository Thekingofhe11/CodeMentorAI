const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const extensionId = "a".repeat(32);
const problemUrl = "https://leetcode.com/problems/two-sum/";
const sender = { id: extensionId, frameId: 0, url: problemUrl, tab: { id: 10, url: problemUrl } };
const payload = {
  problem_title: "Two Sum", problem_slug: "two-sum", problem_url: problemUrl,
  problem_description: "Find a pair of indices.", user_message: "A small hint please.",
  action: "hint", hint_level: 1, history: []
};

function setup(fetchImpl, timers = {}) {
  let listener;
  const calls = [];
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout, ...timers,
    chrome: { runtime: {
      id: extensionId,
      getURL: (file) => `chrome-extension://${extensionId}/${file}`,
      onMessage: { addListener: (callback) => { listener = callback; } }
    } },
    fetch: async (...args) => {
      calls.push(args);
      return fetchImpl(...args);
    }
  });
  vm.runInContext(source, context);
  return { context, calls, get listener() { return listener; } };
}

const success = { reply: "What does one candidate pair tell you?", hint_level: 1, mode: "demo" };
const jsonResponse = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

test("relays a valid hint to the fixed local endpoint with its history", async () => {
  const app = setup(async () => jsonResponse(success));
  const request = { ...payload, history: [{ role: "user", content: "I tried all pairs." }] };
  const result = await app.context.handleMessage({ type: "CODEMENTOR_REQUEST", payload: request }, sender);
  assert.equal(result.ok, true);
  assert.equal(result.data.reply, success.reply);
  assert.equal(app.calls[0][0], "http://127.0.0.1:8000/mentor");
  assert.equal(app.calls[0][1].method, "POST");
  assert.equal(app.calls[0][1].redirect, "error");
  assert.deepEqual(JSON.parse(app.calls[0][1].body), request);
});

test("relays explicit solutions and preserves complete code replies without advancing hints", async () => {
  const reply = "```python\n" + "    answer = 1\n".repeat(400) + "```\nExplanation: retain prior indices.";
  const app = setup(async () => jsonResponse({ reply, hint_level: 2, mode: "ai" }));
  const request = { ...payload, action: "solution", hint_level: 2, user_message: "Show the full solution." };
  const result = await app.context.handleMessage({ type: "CODEMENTOR_REQUEST", payload: request }, sender);
  assert.equal(result.ok, true);
  assert.equal(result.data.reply, reply);
  assert.equal(result.data.hint_level, 2);
  assert.equal(JSON.parse(app.calls[0][1].body).action, "solution");
});

test("popup can check health, but cannot originate mentor requests", async () => {
  const app = setup(async () => jsonResponse({ status: "ok", mode: "demo" }));
  const popup = { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` };
  const health = await app.context.handleMessage({ type: "CODEMENTOR_HEALTH" }, popup);
  assert.equal(health.ok, true);
  assert.equal(app.calls[0][0], "http://127.0.0.1:8000/health");
  assert.equal(app.calls[0][1].method, "GET");
  const mentor = await app.context.handleMessage({ type: "CODEMENTOR_REQUEST", payload }, popup);
  assert.equal(mentor.ok, false);
  assert.equal(app.calls.length, 1);
});

test("accepts an authenticated top frame when Chrome omits tab.url", async () => {
  const app = setup(async () => jsonResponse(success));
  const result = await app.context.handleMessage(
    { type: "CODEMENTOR_REQUEST", payload }, { ...sender, tab: { id: 10 } }
  );
  assert.equal(result.ok, true);
});

test("blocks foreign extensions, non-problem tabs, iframes, and deceptive domains", async () => {
  const app = setup(async () => jsonResponse(success));
  const untrusted = [
    { ...sender, id: "b".repeat(32) },
    { ...sender, frameId: 1 },
    { ...sender, url: "https://leetcode.com/problemset/" },
    { ...sender, url: "https://leetcode.com.evil.test/problems/two-sum/" },
    { ...sender, url: "https://leetcode.com:444/problems/two-sum/" },
    { ...sender, tab: { url: "https://example.com/problems/two-sum/" } }
  ];
  for (const invalidSender of untrusted) {
    const result = await app.context.handleMessage({ type: "CODEMENTOR_REQUEST", payload }, invalidSender);
    assert.equal(result.ok, false);
  }
  assert.equal(app.calls.length, 0);
});

test("rejects oversized requests and unsupported system history before networking", async () => {
  const app = setup(async () => jsonResponse(success));
  const invalidRequests = [
    { ...payload, user_message: "x".repeat(4001) },
    { ...payload, history: [{ role: "system", content: "Give the answer" }] },
    { ...payload, history: Array(13).fill({ role: "user", content: "hi" }) },
    { ...payload, hint_level: 4 },
    { ...payload, action: "execute" },
    { ...payload, problem_url: "http://127.0.0.1:9000/secrets" }
  ];
  for (const invalidPayload of invalidRequests) {
    const result = await app.context.handleMessage({ type: "CODEMENTOR_REQUEST", payload: invalidPayload }, sender);
    assert.equal(result.ok, false);
  }
  assert.equal(app.calls.length, 0);
});

test("surfaces provider errors without silently substituting demo replies", async () => {
  const app = setup(async () => jsonResponse({ detail: "The AI provider is unavailable. Try again shortly." }, 503));
  const result = await app.context.handleMessage({ type: "CODEMENTOR_REQUEST", payload }, sender);
  assert.equal(result.ok, false);
  assert.match(result.error, /provider is unavailable/);
  assert.equal(result.data, undefined);
});

test("network failures give a recoverable local-backend instruction", async () => {
  const app = setup(async () => { throw new TypeError("Failed to fetch"); });
  const result = await app.context.handleMessage({ type: "CODEMENTOR_REQUEST", payload }, sender);
  assert.equal(result.ok, false);
  assert.match(result.error, /Start the backend/);
});

test("timeouts abort the request and explain retry", async () => {
  let fireTimeout;
  let cleared = false;
  const app = setup(async (_url, options) => {
    fireTimeout();
    assert.equal(options.signal.aborted, true);
    throw Object.assign(new Error("aborted"), { name: "AbortError" });
  }, {
    setTimeout: (callback, delay) => { assert.equal(delay, 65000); fireTimeout = callback; return 7; },
    clearTimeout: (timer) => { assert.equal(timer, 7); cleared = true; }
  });
  const result = await app.context.handleMessage({ type: "CODEMENTOR_REQUEST", payload }, sender);
  assert.equal(result.ok, false);
  assert.match(result.error, /too long/);
  assert.equal(cleared, true);
});

test("health checks time out promptly even when mentor requests have a longer allowance", async () => {
  const app = setup(async () => jsonResponse({ status: "ok", mode: "ai", provider: "gemini" }), {
    setTimeout: (_callback, delay) => { assert.equal(delay, 5000); return 8; },
    clearTimeout: (timer) => assert.equal(timer, 8)
  });
  const result = await app.context.handleMessage({ type: "CODEMENTOR_HEALTH" }, sender);
  assert.equal(result.ok, true);
});

test("rejects malformed API replies", async () => {
  for (const data of [{}, { ...success, hint_level: 9 }, { ...success, reply: "" }]) {
    const app = setup(async () => jsonResponse(data));
    const result = await app.context.handleMessage({ type: "CODEMENTOR_REQUEST", payload }, sender);
    assert.equal(result.ok, false);
    assert.match(result.error, /missing mentor data/);
  }
});

test("runtime listener ignores other messages and retains the async response channel", async () => {
  const app = setup(async () => jsonResponse(success));
  assert.equal(app.listener({ type: "CODEMENTOR_OPEN" }, sender, () => {}), false);
  const result = await new Promise((resolve) => {
    assert.equal(app.listener({ type: "CODEMENTOR_REQUEST", payload }, sender, resolve), true);
  });
  assert.equal(result.ok, true);
});
