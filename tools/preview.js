"use strict";

// Only this local fixture has a mock Chrome API. The shipped extension uses Chrome's API.
const storedData = () => JSON.parse(localStorage.getItem("codementor.preview") || "{}");
const writeData = (data) => localStorage.setItem("codementor.preview", JSON.stringify(data));
const runtimeListeners = [];
globalThis.chrome = {
  runtime: {
    id: "codementor-local-preview",
    getURL: (file) => `/extension/${file}`,
    onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
    async sendMessage(message) {
      const isHealth = message.type === "CODEMENTOR_HEALTH";
      if (!isHealth && message.type !== "CODEMENTOR_REQUEST") {
        return { ok: false, error: "Unsupported preview message." };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), isHealth ? 5000 : 65000);
      try {
        const response = await fetch(`/api/${isHealth ? "health" : "mentor"}`, {
          method: isHealth ? "GET" : "POST",
          ...(isHealth ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(message.payload) }),
          signal: controller.signal
        });
        const data = await response.json();
        return response.ok ? { ok: true, data } : {
          ok: false, error: typeof data.detail === "string" ? data.detail : "The local backend could not read this request."
        };
      } catch (error) {
        return { ok: false, error: error.name === "AbortError" ? "The mentor took too long to respond. Please try again." : "Cannot reach the local preview API. Check that the preview server is running." };
      } finally {
        clearTimeout(timer);
      }
    }
  },
  storage: { local: {
    async get(keys) {
      const data = storedData();
      if (keys === null || keys === undefined) return data;
      if (typeof keys === "string") return { [keys]: data[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, data[key]]));
      return { ...keys, ...Object.fromEntries(Object.keys(keys).filter((key) => key in data).map((key) => [key, data[key]])) };
    },
    async set(values) { writeData({ ...storedData(), ...values }); },
    async remove(keys) {
      const data = storedData();
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      writeData(data);
    }
  } }
};

const problems = {
  "two-sum": {
    title: "1. Two Sum",
    paragraphs: ["Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.", "You may assume that each input would have exactly one solution, and you may not use the same element twice.", "You can return the answer in any order."],
    examples: ["Input: nums = [2, 7, 11, 15], target = 9\nOutput: [0, 1]\nExplanation: Because nums[0] + nums[1] == 9, we return [0, 1].", "Input: nums = [3, 2, 4], target = 6\nOutput: [1, 2]"],
    constraints: ["2 ≤ nums.length ≤ 10⁴", "−10⁹ ≤ nums[i] ≤ 10⁹", "−10⁹ ≤ target ≤ 10⁹", "Only one valid answer exists."],
    code: "/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nvar twoSum = function(nums, target) {\n    // Your thinking starts here.\n\n};",
    caseLabel: "nums =", caseValue: "[2, 7, 11, 15]"
  },
  "valid-parentheses": {
    title: "20. Valid Parentheses",
    paragraphs: ["Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.", "Open brackets must be closed by the same type of brackets and in the correct order. Every close bracket must have a corresponding open bracket of the same type."],
    examples: ["Input: s = \"()[]{}\"\nOutput: true", "Input: s = \"(]\"\nOutput: false"],
    constraints: ["1 ≤ s.length ≤ 10⁴", "s consists of parentheses only: ()[]{}."],
    code: "/**\n * @param {string} s\n * @return {boolean}\n */\nvar isValid = function(s) {\n    // What makes an arrangement valid?\n\n};",
    caseLabel: "s =", caseValue: "\"()[]{}\""
  },
  "binary-search": {
    title: "704. Binary Search",
    paragraphs: ["Given an array of integers nums sorted in ascending order, and an integer target, write a function to search target in nums. If target exists, return its index. Otherwise, return -1.", "Your algorithm must have O(log n) runtime complexity."],
    examples: ["Input: nums = [-1, 0, 3, 5, 9, 12], target = 9\nOutput: 4", "Input: nums = [-1, 0, 3, 5, 9, 12], target = 2\nOutput: -1"],
    constraints: ["1 ≤ nums.length ≤ 10⁴", "All the integers in nums are unique.", "nums is sorted in ascending order."],
    code: "/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number}\n */\nvar search = function(nums, target) {\n    // What can the sorted order tell you?\n\n};",
    caseLabel: "nums =", caseValue: "[-1, 0, 3, 5, 9, 12]"
  }
};

function renderProblem() {
  const slug = location.pathname.split("/")[2];
  const problem = problems[slug] || problems["two-sum"];
  document.title = `${problem.title} · CodeMentor preview`;
  document.querySelector('[data-cy="question-title"]').textContent = problem.title;
  const description = document.querySelector('[data-track-load="description_content"]');
  description.replaceChildren();
  for (const paragraph of problem.paragraphs) {
    const node = document.createElement("p"); node.textContent = paragraph; description.append(node);
  }
  problem.examples.forEach((example, index) => {
    const heading = document.createElement("h2"); heading.textContent = `Example ${index + 1}:`;
    const node = document.createElement("pre"); node.textContent = example; description.append(heading, node);
  });
  const heading = document.createElement("h2"); heading.textContent = "Constraints:";
  const list = document.createElement("ul");
  for (const constraint of problem.constraints) {
    const node = document.createElement("li"); node.textContent = constraint; list.append(node);
  }
  description.append(heading, list);
  document.getElementById("editor-code").textContent = problem.code;
  document.getElementById("case-label").textContent = problem.caseLabel;
  document.getElementById("case-value").textContent = problem.caseValue;
  for (const link of document.querySelectorAll("[data-problem-link]")) {
    if (link.pathname === location.pathname) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-problem-link]");
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.pushState({}, "", link.href);
  renderProblem();
});
window.addEventListener("popstate", renderProblem);
renderProblem();
