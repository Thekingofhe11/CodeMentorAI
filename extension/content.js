(() => {
  "use strict";
  if (document.getElementById("codementor-root")) return;
  const { problemSlug, titleFromSlug, cleanSession, buildRequest, replyParts } = globalThis.CodeMentorCore;
  const storagePrefix = "codementor.session.";
  const icons = {
    mark: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  };
  const host = document.createElement("div");
  host.id = "codementor-root";
  const shadow = host.attachShadow({ mode: "open" });
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = chrome.runtime.getURL("styles.css");
  shadow.append(sheet);
  const container = document.createElement("div");
  // Static markup only. Page, user, storage, and model text always uses textContent.
  container.innerHTML = `
    <button id="cm-launcher" data-glass-surface aria-label="Open CodeMentor" aria-expanded="false" aria-controls="cm-panel">
      <span class="cm-launcher-icon">${icons.mark}</span><span>Need a nudge?</span><span class="cm-launcher-dot"></span>
    </button>
    <section id="cm-panel" data-glass-surface role="region" aria-label="CodeMentor problem-solving mentor" hidden>
      <div class="cm-ambient" aria-hidden="true"></div>
      <header class="cm-header">
        <span class="cm-brand-icon" data-glass-reactive>${icons.mark}</span>
        <div class="cm-brand"><strong>CodeMentor<span>AI</span></strong><span>Your thinking partner</span></div>
        <button id="cm-reset" class="cm-icon-button" data-glass-reactive aria-label="Start a fresh conversation" title="Start a fresh conversation">↺</button>
        <button id="cm-close" class="cm-icon-button" data-glass-reactive aria-label="Close mentor" title="Close mentor">×</button>
      </header>
      <div class="cm-problem-card" data-glass-reactive>
        <div class="cm-eyebrow">WORKING ON <span id="cm-difficulty"></span></div>
        <h2 id="cm-problem-title"></h2><div id="cm-context-state" class="cm-context-state"></div>
        <details class="cm-problem-summary"><summary>Problem brief</summary><p id="cm-problem-brief"></p></details>
      </div>
      <div class="cm-journey">
        <div class="cm-journey-heading"><span>A LITTLE HELP, ONE STEP AT A TIME</span><span id="cm-hint-count">0 / 3</span></div>
        <ol aria-label="Hint progression"><li data-level="1"><span>1</span>Notice</li><li data-level="2"><span>2</span>Explore</li><li data-level="3"><span>3</span>Connect</li></ol>
      </div>
      <div id="cm-chat" role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation"></div>
      <div id="cm-error" role="alert" hidden><span></span><button id="cm-retry" data-glass-reactive type="button" hidden>Try again</button></div>
      <div class="cm-actions">
        <button id="cm-hint" data-glass-reactive type="button">${icons.spark}<span>A small hint</span></button>
        <button id="cm-review" data-glass-reactive type="button">Check my approach</button>
        <button id="cm-edge" data-glass-reactive type="button">An edge case</button>
        <button id="cm-solution" data-glass-reactive type="button" title="Show complete code and an explanation">Full solution</button>
      </div>
      <form id="cm-form">
        <label class="cm-sr-only" for="cm-input">Share your thinking or ask a question</label>
        <div class="cm-composer" data-glass-reactive><textarea id="cm-input" rows="2" maxlength="4000" placeholder="What have you tried so far?"></textarea><button id="cm-send" data-glass-reactive type="submit" aria-label="Send message">${icons.arrow}</button></div>
        <div class="cm-composer-note"><span>Hints first. Full solutions when you ask.</span><span>Enter to send</span></div>
      </form>
      <footer class="cm-footer"><span id="cm-mode" role="status">Checking connection…</span><span title="The problem description and conversation are sent only when you ask. Editor code is never read.">Shares problem + chat when you ask</span></footer>
    </section>`;
  shadow.append(container);
  document.documentElement.append(host);
  const $ = (selector) => shadow.querySelector(selector);
  const panel = $("#cm-panel"), launcher = $("#cm-launcher"), input = $("#cm-input"), chat = $("#cm-chat");
  sheet.addEventListener("load", () => { if (!panel.hidden) chat.scrollTop = chat.scrollHeight; });
  const panelGlass = globalThis.CodeMentorGlass.attach(panel);
  const launcherGlass = globalThis.CodeMentorGlass.attach(launcher);
  const sessions = new Map();
  let problem = null, session = cleanSession(null), version = 0, loading = false, busy = false;
  let mode = "offline", lastRequest = null, saveQueue = Promise.resolve();
  let stopVisuals = null;

  function syncVisuals() {
    const visible = Boolean(problem) && !panel.hidden;
    if (visible && !stopVisuals) stopVisuals = globalThis.CodeMentorVisuals?.mount($(".cm-ambient")) || null;
    else if (!visible && stopVisuals) { stopVisuals(); stopVisuals = null; }
  }

  function getProblem() {
    const slug = problemSlug(location.pathname);
    if (!slug) return null;
    const titleElement = document.querySelector('[data-cy="question-title"]') ||
      document.querySelector(`a[href="/problems/${slug}/"][class*="text-title"]`) ||
      document.querySelector('[class*="text-title-large"]');
    const rawTitle = titleElement?.textContent.trim() || document.title.replace(/\s*[-–|]\s*LeetCode.*$/i, "");
    const normalizeTitle = (text) => text.replace(/^\d+\.\s*/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // A SPA may update its URL before replacing the previous problem's DOM.
    const matchesRoute = normalizeTitle(rawTitle) === normalizeTitle(slug);
    const title = matchesRoute ? rawTitle : titleFromSlug(slug);
    // Restrict capture to description containers; never read editor or full page text.
    const descriptionElement = document.querySelector('[data-track-load="description_content"]') ||
      document.querySelector('[data-cy="question-content"]') || document.querySelector(".elfjS");
    const description = matchesRoute ? (descriptionElement?.innerText || descriptionElement?.textContent || "").trim().slice(0, 14000) : "";
    const difficultyText = document.querySelector('[diff], [class*="text-difficulty-"]')?.textContent.trim();
    return { slug, title, description, difficulty: matchesRoute && ["Easy", "Medium", "Hard"].includes(difficultyText) ? difficultyText : "", url: `https://leetcode.com/problems/${slug}/` };
  }
  async function request(message) {
    try {
      const result = await chrome.runtime.sendMessage(message);
      if (!result?.ok) throw new Error(result?.error || "The mentor could not respond. Please try again.");
      return result.data;
    } catch (error) {
      if (/context invalidated|receiving end does not exist/i.test(error.message)) throw new Error("The extension was updated. Refresh this LeetCode tab to reconnect.");
      throw error;
    }
  }
  function showError(message = "", retry = false) {
    $("#cm-error").hidden = !message;
    $("#cm-error span").textContent = message;
    $("#cm-retry").hidden = !retry;
  }
  function updateMode(nextMode) {
    mode = nextMode;
    $("#cm-mode").textContent = mode === "ai" ? "AI configured" : mode === "demo" ? "Demo coach" : "Backend offline";
    $("#cm-mode").dataset.mode = mode;
    const note = $(".cm-demo-note");
    if (note) note.hidden = mode !== "demo";
  }
  async function checkHealth() {
    try { updateMode((await request({ type: "CODEMENTOR_HEALTH" })).mode); }
    catch { updateMode("offline"); }
  }
  function refreshControls() {
    const disabled = busy || loading || !problem;
    for (const id of ["#cm-send", "#cm-review", "#cm-edge", "#cm-solution", "#cm-reset"]) $(id).disabled = disabled;
    input.disabled = disabled;
    $("#cm-hint").disabled = disabled || session.hintLevel >= 3;
    $("#cm-hint span").textContent = session.hintLevel >= 3 ? "Hints explored" : session.hintLevel ? "One more nudge" : "A small hint";
    $("#cm-hint").title = session.hintLevel >= 3 ? "Keep discussing your reasoning in the chat." : "Reveal only the next hint";
    $("#cm-hint-count").textContent = `${session.hintLevel} / 3`;
    shadow.querySelectorAll(".cm-journey li").forEach((step) => {
      step.classList.toggle("cm-reached", Number(step.dataset.level) <= session.hintLevel);
      if (Number(step.dataset.level) === session.hintLevel) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
  }
  function addMessage(role, content) {
    const article = document.createElement("article");
    article.className = `cm-message cm-${role}`;
    const label = document.createElement("div");
    label.className = "cm-message-label";
    label.textContent = role === "assistant" ? "CODEMENTOR" : "YOU";
    article.append(label);
    const parts = role === "assistant" ? replyParts(content) : [{ type: "text", content }];
    for (const part of parts) {
      if (part.type === "code") {
        const block = document.createElement("div");
        block.className = "cm-code-block";
        const language = document.createElement("div");
        language.className = "cm-code-language";
        language.textContent = part.language || "Code";
        const pre = document.createElement("pre");
        pre.tabIndex = 0;
        pre.setAttribute("aria-label", `${part.language || "Solution"} code`);
        const code = document.createElement("code");
        code.textContent = part.content;
        pre.append(code);
        block.append(language, pre);
        article.append(block);
      } else {
        const text = document.createElement("p");
        text.textContent = role === "assistant" ? part.content.trim() : part.content;
        article.append(text);
      }
    }
    chat.append(article);
  }
  function renderConversation() {
    panelGlass.reset();
    chat.replaceChildren();
    const welcome = document.createElement("div");
    welcome.className = "cm-welcome";
    welcome.innerHTML = `<span class="cm-welcome-icon">${icons.spark}</span><h3>Let’s think it through.</h3><p>Start with a nudge, or ask for a full solution with code and an explanation.</p><div class="cm-opening-question" data-glass-reactive>What do you understand about the problem, and where are you getting stuck?</div><p class="cm-demo-note" hidden>Demo coach offers guided prompts and Python solutions for a few sample problems. Connect AI for tailored feedback and other problems.</p>`;
    chat.append(welcome);
    updateMode(mode);
    for (const message of session.messages) addMessage(message.role, message.content);
    refreshControls();
    chat.scrollTop = chat.scrollHeight;
  }
  function persistSession(slug, value) {
    const snapshot = cleanSession({ ...value, updatedAt: Date.now() });
    sessions.set(slug, snapshot);
    saveQueue = saveQueue.then(async () => {
      await chrome.storage.local.set({ [storagePrefix + slug]: snapshot });
      const stored = await chrome.storage.local.get(null);
      const oldKeys = Object.keys(stored).filter((key) => key.startsWith(storagePrefix))
        .sort((a, b) => (stored[b]?.updatedAt || 0) - (stored[a]?.updatedAt || 0)).slice(30);
      if (oldKeys.length) await chrome.storage.local.remove(oldKeys);
    }).catch(() => showError("This conversation could not be saved locally. You can continue in this tab."));
  }
  async function syncProblem() {
    const detected = getProblem();
    if (!detected) {
      panelGlass.reset(); launcherGlass.reset();
      if (problem) { version++; problem = null; busy = false; loading = false; }
      host.style.display = "none";
      syncVisuals();
      return;
    }
    host.style.display = "block";
    $("#cm-problem-title").textContent = detected.title;
    $("#cm-difficulty").textContent = detected.difficulty;
    $("#cm-difficulty").dataset.difficulty = detected.difficulty.toLowerCase();
    $("#cm-context-state").textContent = detected.description ? "Problem context ready" : "Open the Description tab for problem context";
    $("#cm-context-state").classList.toggle("cm-context-missing", !detected.description);
    $("#cm-problem-brief").textContent = detected.description
      ? detected.description.split(/\n\s*(?:Example|Constraints)/i)[0].trim().slice(0, 800)
      : "Open the problem’s Description tab, or paste the relevant requirement in the chat.";
    if (problem?.slug === detected.slug) { problem = detected; syncVisuals(); return; }
    problem = detected;
    syncVisuals();
    const currentVersion = ++version;
    busy = false; loading = true; lastRequest = null;
    input.value = ""; showError();
    chat.setAttribute("aria-busy", "false");
    session = cleanSession(sessions.get(detected.slug));
    renderConversation();
    try {
      await saveQueue;
      const stored = await chrome.storage.local.get(storagePrefix + detected.slug);
      if (version !== currentVersion) return;
      session = cleanSession(stored[storagePrefix + detected.slug] || sessions.get(detected.slug));
    } catch {
      if (version !== currentVersion) return;
      showError("Local history is unavailable. This conversation will stay in this tab.");
    }
    if (version !== currentVersion) return;
    loading = false;
    renderConversation();
  }
  async function ask(text, action = "chat") {
    if (busy || loading || !problem || !text.trim()) return;
    if (problemSlug(location.pathname) !== problem.slug) { await syncProblem(); return; }
    problem = getProblem();
    const payload = buildRequest(problem, session, text, action);
    const currentVersion = version, currentSlug = problem.slug, draft = input.value;
    input.value = ""; lastRequest = { text, action }; busy = true;
    showError(); refreshControls(); addMessage("user", text);
    const waiting = document.createElement("div");
    waiting.className = "cm-thinking"; waiting.textContent = "Thinking with you…";
    chat.append(waiting); chat.setAttribute("aria-busy", "true"); chat.scrollTop = chat.scrollHeight;
    try {
      const data = await request({ type: "CODEMENTOR_REQUEST", payload });
      if (currentVersion !== version || problemSlug(location.pathname) !== currentSlug) return;
      if (typeof data?.reply !== "string" || !data.reply.trim() || !["ai", "demo"].includes(data.mode)) throw new Error("The mentor returned an incomplete response. Please try again.");
      session.messages.push({ role: "user", content: text }, { role: "assistant", content: data.reply });
      session.hintLevel = payload.hint_level;
      session = cleanSession(session);
      persistSession(currentSlug, session); updateMode(data.mode); lastRequest = null;
      if (["hint", "edge_cases", "solution"].includes(action)) input.value = draft;
    } catch (error) {
      if (currentVersion !== version || problemSlug(location.pathname) !== currentSlug) return;
      input.value = draft;
      showError(error.message || "Could not connect to the mentor. Start the backend and try again.", true);
    } finally {
      if (currentVersion === version) {
        busy = false; chat.setAttribute("aria-busy", "false"); renderConversation();
        if (!panel.hidden) input.focus();
      }
    }
  }
  function openPanel() {
    if (!problem) return;
    panelGlass.reset(); launcherGlass.reset();
    panel.hidden = false; launcher.hidden = true; launcher.setAttribute("aria-expanded", "true");
    syncVisuals();
    chat.scrollTop = chat.scrollHeight;
    input.focus(); checkHealth();
  }
  function closePanel() {
    panelGlass.reset(); launcherGlass.reset();
    panel.hidden = true; launcher.hidden = false; launcher.setAttribute("aria-expanded", "false"); launcher.focus();
    syncVisuals();
  }
  window.addEventListener("pagehide", () => { stopVisuals?.(); stopVisuals = null; });
  window.addEventListener("pageshow", syncVisuals);
  launcher.addEventListener("click", openPanel);
  $("#cm-close").addEventListener("click", closePanel);
  $("#cm-form").addEventListener("submit", (event) => { event.preventDefault(); ask(input.value, "chat"); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(input.value, "chat"); }
  });
  shadow.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) { event.stopPropagation(); closePanel(); }
  });
  $("#cm-hint").addEventListener("click", () => ask("Could you give me one small hint?", "hint"));
  $("#cm-edge").addEventListener("click", () => ask("Help me think of an edge case to test my reasoning.", "edge_cases"));
  $("#cm-solution").addEventListener("click", () => ask("Show me the full solution with code, an explanation, and time and space complexity.", "solution"));
  $("#cm-review").addEventListener("click", () => {
    if (!input.value.trim()) { input.placeholder = "Describe your approach, then click Check my approach…"; input.focus(); showError("Share your approach in the box below so we can think through it together."); return; }
    ask(input.value, "review");
  });
  $("#cm-retry").addEventListener("click", () => { if (lastRequest) ask(lastRequest.text, lastRequest.action); });
  $("#cm-reset").addEventListener("click", () => {
    if (busy || loading || !problem) return;
    session = cleanSession(null); persistSession(problem.slug, session); lastRequest = null;
    input.value = ""; input.placeholder = "What have you tried so far?"; showError(); renderConversation(); input.focus();
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== "CODEMENTOR_OPEN") return false;
    syncProblem().then(() => { openPanel(); sendResponse({ ok: Boolean(problem) }); });
    return true;
  });
  let syncTimer;
  const observer = new MutationObserver(() => {
    if (syncTimer) return;
    syncTimer = setTimeout(() => { syncTimer = null; syncProblem(); }, 500);
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true, characterData: true });
  let previousPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== previousPath) { previousPath = location.pathname; syncProblem(); }
  }, 800);
  syncProblem(); checkHealth();
})();
