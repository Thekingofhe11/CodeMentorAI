(function (root) {
  "use strict";
  function problemSlug(pathname) {
    return pathname.match(/^\/problems\/([a-z0-9-]+)(?:\/|$)/)?.[1] || null;
  }
  function titleFromSlug(slug) {
    return slug.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  }
  function cleanSession(value) {
    const messages = Array.isArray(value?.messages) ? value.messages : [];
    return {
      hintLevel: Number.isInteger(value?.hintLevel) ? Math.max(0, Math.min(3, value.hintLevel)) : 0,
      messages: messages.filter((message) => ["user", "assistant"].includes(message?.role) && typeof message.content === "string")
        .slice(-40).map((message) => ({ role: message.role, content: message.content.slice(0, message.role === "assistant" ? 12000 : 4000) })),
      updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : Date.now(),
    };
  }
  function buildRequest(problem, session, text, action = "chat") {
    const clean = cleanSession(session);
    return {
      problem_title: problem.title.slice(0, 300), problem_slug: problem.slug.slice(0, 200),
      problem_url: problem.url.slice(0, 1000), problem_description: problem.description.slice(0, 14000),
      user_message: text.trim().slice(0, 4000), action,
      hint_level: action === "hint" ? Math.min(clean.hintLevel + 1, 3) : clean.hintLevel,
      history: clean.messages.slice(-12).map((message) => ({ ...message, content: message.content.slice(0, 4000) })),
    };
  }
  function replyParts(content) {
    // Keep prose literal and recognize only complete fenced code blocks. Every
    // returned value is rendered with textContent, never interpreted as HTML.
    const parts = [];
    const fences = /^```([a-z0-9_+#.-]*)[ \t]*\r?\n([\s\S]*?)^```[ \t]*(?:\r?\n|$)/gim;
    let offset = 0;
    for (const match of content.matchAll(fences)) {
      if (match.index > offset) parts.push({ type: "text", content: content.slice(offset, match.index) });
      parts.push({ type: "code", language: match[1], content: match[2].replace(/\r?\n$/, "") });
      offset = match.index + match[0].length;
    }
    if (offset < content.length) parts.push({ type: "text", content: content.slice(offset) });
    return parts;
  }
  const core = { problemSlug, titleFromSlug, cleanSession, buildRequest, replyParts };
  if (typeof module !== "undefined" && module.exports) module.exports = core;
  else root.CodeMentorCore = core;
})(globalThis);
