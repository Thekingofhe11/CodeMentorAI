"use strict";

const statusTitle = document.getElementById("connection-title");
const statusDetail = document.getElementById("connection-detail");
const statusDot = document.getElementById("status-dot");
const refreshButton = document.getElementById("refresh");
const setup = document.getElementById("setup");
const openButton = document.getElementById("open-mentor");
const pageContext = document.getElementById("page-context");
const feedback = document.getElementById("action-feedback");
let problemTab = null;

async function checkConnection() {
  refreshButton.disabled = true;
  statusTitle.textContent = "Checking connection…";
  statusDot.className = "status-dot checking";
  try {
    const result = await chrome.runtime.sendMessage({ type: "CODEMENTOR_HEALTH" });
    if (!result?.ok) throw new Error(result?.error || "Cannot reach the local backend.");
    const isAI = result.data.mode === "ai";
    statusTitle.textContent = isAI ? "AI configured" : "Demo mode";
    statusDetail.textContent = isAI
      ? "Your AI mentor is configured. Ask for a small hint or a full solution with code and an explanation."
      : "Try guided practice without a key. Add an API key to the backend for personalized guidance.";
    statusDot.className = "status-dot";
    setup.hidden = true;
  } catch (error) {
    statusTitle.textContent = "Backend offline";
    statusDetail.textContent = error.message;
    statusDot.className = "status-dot offline";
    setup.hidden = false;
  } finally {
    refreshButton.disabled = false;
  }
}

async function findProblemTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url || "about:blank");
    const match = url.pathname.match(/^\/problems\/([a-z0-9-]+)(?:\/|$)/i);
    if (url.protocol === "https:" && url.hostname === "leetcode.com" && match) {
      problemTab = tab;
      pageContext.textContent = `Ready for ${match[1].replace(/-/g, " ")}.`;
    } else {
      pageContext.textContent = "Open a LeetCode problem to start a conversation.";
      openButton.firstChild.textContent = "Try on LeetCode ";
    }
  } catch {
    pageContext.textContent = "Open a LeetCode problem to start a conversation.";
    openButton.firstChild.textContent = "Try on LeetCode ";
  } finally {
    openButton.disabled = false;
  }
}

openButton.addEventListener("click", async () => {
  openButton.disabled = true;
  feedback.textContent = "";
  try {
    if (!problemTab) {
      await chrome.tabs.create({ url: "https://leetcode.com/problems/two-sum/" });
    } else {
      const result = await chrome.tabs.sendMessage(problemTab.id, { type: "CODEMENTOR_OPEN" });
      if (!result?.ok) throw new Error("The page is not ready.");
    }
    window.close();
  } catch {
    feedback.textContent = "Refresh the LeetCode tab once after loading the extension, then open the mentor again.";
  } finally {
    openButton.disabled = false;
  }
});

refreshButton.addEventListener("click", checkConnection);
checkConnection();
findProblemTab();

if (globalThis.CodeMentorGlass && document.body) {
  globalThis.CodeMentorGlass.attach(document.body);
}
