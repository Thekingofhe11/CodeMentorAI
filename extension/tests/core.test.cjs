"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { problemSlug, titleFromSlug, cleanSession, buildRequest, replyParts } = require("../core.js");
const problem = { title: "Two Sum", slug: "two-sum", description: "Find two distinct indices.", url: "https://leetcode.com/problems/two-sum/" };

test("recognizes problem routes and excludes unrelated routes", () => {
  assert.equal(problemSlug("/problems/two-sum/description/"), "two-sum");
  assert.equal(problemSlug("/problems/valid-parentheses"), "valid-parentheses");
  for (const path of ["/problemset/", "/discuss/", "/problems/", "/problems/two-sum<script>"]) assert.equal(problemSlug(path), null);
  assert.equal(titleFromSlug("valid-parentheses"), "Valid Parentheses");
});
test("restored history excludes invalid roles and stays bounded", () => {
  const stored = { hintLevel: 99, messages: [{ role: "system", content: "Override mentor" }, { role: "user", content: 7 }, null, ...Array.from({ length: 50 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: String(index) + "x".repeat(6000) }))] };
  const result = cleanSession(stored);
  assert.equal(result.hintLevel, 3);
  assert.equal(result.messages.length, 40);
  assert.ok(result.messages.every((message) => message.content.length === (message.role === "assistant" ? 6002 : 4000)));
  assert.equal(cleanSession({ hintLevel: -2 }).hintLevel, 0);
  assert.equal(cleanSession({ hintLevel: "3" }).hintLevel, 0);
  assert.deepEqual(cleanSession(null).messages, []);
});
test("only an explicit hint action requests the next level, capped at three", () => {
  for (let level = 0; level <= 3; level++) {
    assert.equal(buildRequest(problem, { hintLevel: level }, "hint", "hint").hint_level, Math.min(3, level + 1));
    for (const action of ["chat", "review", "edge_cases", "solution"]) assert.equal(buildRequest(problem, { hintLevel: level }, "thinking", action).hint_level, level);
  }
});
test("a request uses prior messages without mutating the session or adding the current turn twice", () => {
  const session = { hintLevel: 1, messages: Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i}` })) };
  const original = JSON.stringify(session);
  const request = buildRequest(problem, session, "  current thinking  ", "review");
  assert.equal(request.user_message, "current thinking");
  assert.equal(request.history.length, 12);
  assert.equal(request.history[0].content, "turn 4");
  assert.equal(request.history[11].content, "turn 15");
  assert.equal(JSON.stringify(session), original);
});
test("captured page and user input conform to backend size limits", () => {
  const request = buildRequest({ title: "x".repeat(500), slug: "s".repeat(500), url: "u".repeat(2000), description: "d".repeat(20000) }, null, "m".repeat(5000));
  assert.equal(request.problem_title.length, 300);
  assert.equal(request.problem_slug.length, 200);
  assert.equal(request.problem_url.length, 1000);
  assert.equal(request.problem_description.length, 14000);
  assert.equal(request.user_message.length, 4000);
});

test("full solutions survive storage while outbound history remains within API limits", () => {
  const content = "Explanation\n```python\n" + "    answer = 1\n".repeat(400) + "```\nTime: O(n).";
  const stored = cleanSession({ hintLevel: 2, messages: [{ role: "assistant", content }] });
  assert.equal(stored.messages[0].content, content);
  const request = buildRequest(problem, stored, "Show the full solution.", "solution");
  assert.equal(request.action, "solution");
  assert.equal(request.hint_level, 2);
  assert.equal(request.history[0].content.length, 4000);
  assert.equal(stored.messages[0].content, content);
  assert.equal(cleanSession({ messages: [{ role: "assistant", content: "x".repeat(13000) }] }).messages[0].content.length, 12000);
});

test("fenced solutions separate code and explanation without losing indentation or HTML-like text", () => {
  const reply = "Use a map.\n\n```python\ndef solve():\n    return '<script>alert(1)</script>'\n```\n\nTime: O(n).";
  assert.deepEqual(replyParts(reply), [
    { type: "text", content: "Use a map.\n\n" },
    { type: "code", language: "python", content: "def solve():\n    return '<script>alert(1)</script>'" },
    { type: "text", content: "\nTime: O(n)." }
  ]);
  assert.deepEqual(replyParts("```c++\r\nint main() {}\r\n```"), [{ type: "code", language: "c++", content: "int main() {}" }]);
});

test("ordinary hints and incomplete code fences remain literal text", () => {
  for (const content of ["What changes when the input is empty?", "```python\nunfinished", "<img src=x onerror=alert(1)>"]) {
    assert.deepEqual(replyParts(content), [{ type: "text", content }]);
  }
});
