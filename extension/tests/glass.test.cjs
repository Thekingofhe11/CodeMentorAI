const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "glass.js"), "utf8");
const fineQuery = "(hover: hover) and (pointer: fine)";
const reducedQuery = "(prefers-reduced-motion: reduce)";
const colorsQuery = "(forced-colors: active)";

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback(event);
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((total, callbacks) => total + callbacks.size, 0);
  }
}

function setup(settings = {}) {
  const document = new Events();
  document.hidden = false;
  const window = new Events();
  document.defaultView = window;
  const frames = new Map();
  let frameId = 0;
  window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  const media = new Map([
    [fineQuery, Object.assign(new Events(), { matches: settings.fine ?? true })],
    [reducedQuery, Object.assign(new Events(), { matches: settings.reduced ?? false })],
    [colorsQuery, Object.assign(new Events(), { matches: settings.colors ?? false })]
  ]);
  window.matchMedia = (query) => media.get(query);

  class Element extends Events {
    constructor(parent, left, top, reactive = false) {
      super();
      this.nodeType = 1;
      this.ownerDocument = document;
      this.parentElement = parent;
      this.disabled = false;
      this.rect = { left, top, width: 300, height: 200 };
      this.attributes = new Map(reactive ? [["data-glass-reactive", ""]] : []);
      this.styleValues = new Map();
      this.styleWrites = [];
      this.style = {
        setProperty: (key, value) => { this.styleValues.set(key, value); this.styleWrites.push([key, value]); },
        removeProperty: (key) => { this.styleValues.delete(key); this.styleWrites.push([key, null]); }
      };
    }
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    hasAttribute(key) { return this.attributes.has(key); }
    matches(selector) { assert.equal(selector, ":disabled"); return this.disabled; }
    getBoundingClientRect() { return this.rect; }
    contains(target) {
      for (let element = target; element; element = element.parentElement) {
        if (element === this) return true;
      }
      return false;
    }
    get textContent() { throw new Error("Glass effects must not read content."); }
    get value() { throw new Error("Glass effects must not read input values."); }
  }

  const surface = new Element(null, 10, 20);
  const card = new Element(surface, 20, 40, true);
  const button = new Element(card, 30, 50, true);
  const icon = new Element(button, 35, 55);
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const controller = context.CodeMentorGlass.attach(surface);

  return {
    document, window, media, frames, surface, card, button, icon, controller, api: context.CodeMentorGlass,
    move(target = icon, x = 70, y = 90, pointerType = "mouse") {
      const eventPath = [];
      for (let element = target; element; element = element.parentElement) eventPath.push(element);
      surface.emit("pointermove", { target, clientX: x, clientY: y, pointerType, composedPath: () => eventPath });
    },
    flush() {
      const callbacks = [...frames.entries()];
      for (const [id, callback] of callbacks) { frames.delete(id); callback(); }
    },
    setMedia(query, matches) {
      const result = media.get(query);
      result.matches = matches;
      result.emit("change");
    }
  };
}

const active = (app) => app.surface.hasAttribute("data-glass-active");
const hovering = (element) => element.hasAttribute("data-glass-hover");

test("batches a mouse burst into one frame using the latest coordinates", () => {
  const app = setup();
  assert.equal(app.api.attach(app.surface), app.controller, "repeated attachment must reuse listeners");
  app.move(app.icon, 60, 80);
  app.move(app.icon, 70, 90);
  assert.equal(app.frames.size, 1);
  assert.equal(app.surface.styleWrites.length, 0);
  assert.equal(active(app), false);
  app.flush();
  assert.equal(active(app), true);
  assert.equal(app.surface.styleValues.get("--glass-x"), "60px");
  assert.equal(app.surface.styleValues.get("--glass-y"), "70px");
  assert.equal(app.surface.styleWrites.length, 2);
  assert.equal(app.frames.size, 0);
  assert.equal(app.surface.styleValues.has("transform"), false);
});

test("highlights nested reactive controls and clears old local highlights on movement", () => {
  const app = setup();
  app.move();
  app.flush();
  assert.equal(hovering(app.button), true);
  assert.equal(hovering(app.card), true);
  assert.equal(app.button.styleValues.get("--glass-local-x"), "40px");
  assert.equal(app.button.styleValues.get("--glass-local-y"), "40px");
  assert.equal(app.card.styleValues.get("--glass-local-x"), "50px");
  app.move(app.card, 80, 100);
  app.flush();
  assert.equal(hovering(app.button), false);
  assert.equal(app.button.styleValues.size, 0);
  assert.equal(hovering(app.card), true);
  app.move(app.surface, 90, 110);
  app.flush();
  assert.equal(hovering(app.card), false);
  assert.equal(app.card.styleValues.size, 0);
  assert.equal(active(app), true);
});

test("leave, cancellation, blur, and a hidden document clear effects and cancel pending frames", () => {
  for (const trigger of [
    (app) => app.surface.emit("pointerleave"),
    (app) => app.surface.emit("pointercancel"),
    (app) => app.window.emit("blur"),
    (app) => { app.document.hidden = true; app.document.emit("visibilitychange"); }
  ]) {
    const app = setup();
    app.move();
    app.flush();
    app.move(app.icon, 80, 100);
    trigger(app);
    assert.equal(app.frames.size, 0);
    assert.equal(active(app), false);
    assert.equal(hovering(app.button), false);
    assert.equal(hovering(app.card), false);
    assert.equal(app.surface.styleValues.size, 0);
    app.flush();
    assert.equal(active(app), false, "cancelled work must not restore a highlight");
  }
});

test("reset is reusable and destroy removes listeners and prevents later writes", () => {
  const app = setup();
  app.move();
  app.controller.reset();
  assert.equal(app.frames.size, 0);
  app.move();
  app.flush();
  assert.equal(active(app), true);
  app.move();
  app.controller.destroy();
  app.controller.destroy();
  assert.equal(app.frames.size, 0);
  assert.equal(active(app), false);
  assert.equal(app.surface.listenerCount, 0);
  assert.equal(app.window.listenerCount, 0);
  assert.equal(app.document.listenerCount, 0);
  for (const query of app.media.values()) assert.equal(query.listenerCount, 0);
  app.move();
  app.flush();
  assert.equal(active(app), false);
  assert.notEqual(app.api.attach(app.surface), app.controller, "a destroyed surface can be attached again");
});

test("reduced motion blocks effects initially and cancels work when changed live", () => {
  const app = setup({ reduced: true });
  app.move();
  assert.equal(app.frames.size, 0);
  app.setMedia(reducedQuery, false);
  app.move();
  app.flush();
  assert.equal(active(app), true);
  app.move();
  app.setMedia(reducedQuery, true);
  assert.equal(active(app), false);
  assert.equal(app.frames.size, 0);
  app.setMedia(reducedQuery, false);
  assert.equal(active(app), false, "restoring motion requires a fresh mouse movement");
  app.move();
  app.flush();
  assert.equal(active(app), true);
});

test("coarse pointers and forced colors block effects and respond to media changes", () => {
  for (const [setting, query, initiallyBlocked, restored] of [
    ["fine", fineQuery, false, true], ["colors", colorsQuery, true, false]
  ]) {
    const app = setup({ [setting]: initiallyBlocked });
    app.move();
    assert.equal(app.frames.size, 0);
    app.setMedia(query, restored);
    app.move();
    app.flush();
    assert.equal(active(app), true);
    app.setMedia(query, initiallyBlocked);
    assert.equal(active(app), false);
    assert.equal(hovering(app.button), false);
  }
});

test("touch and pen pointers never activate highlights, even on a fine-pointer device", () => {
  const app = setup();
  for (const pointerType of ["touch", "pen", ""]) {
    app.move();
    app.flush();
    app.move(app.icon, 80, 100, pointerType);
    assert.equal(active(app), false);
    assert.equal(app.frames.size, 0);
  }
});

test("disabled and aria-disabled controls are ignored, including disabled descendants", () => {
  const app = setup();
  app.button.disabled = true;
  app.move();
  assert.equal(app.frames.size, 0);
  assert.equal(active(app), false);
  app.button.disabled = false;
  app.card.setAttribute("aria-disabled", "true");
  app.move();
  assert.equal(app.frames.size, 0);
  app.card.removeAttribute("aria-disabled");
  app.move();
  app.button.disabled = true;
  app.flush();
  assert.equal(active(app), false, "a control disabled before the frame must stay inactive");
  assert.equal(hovering(app.card), false);
  app.surface.disabled = true;
  app.move(app.surface);
  assert.equal(app.frames.size, 0, "a surface that is itself a disabled control stays inactive");
});

test("detached controls and hidden documents cannot receive pending highlights", () => {
  const app = setup();
  app.move();
  app.card.parentElement = null;
  app.flush();
  assert.equal(active(app), false);
  app.card.parentElement = app.surface;
  app.document.hidden = true;
  app.move();
  assert.equal(app.frames.size, 0);
});
