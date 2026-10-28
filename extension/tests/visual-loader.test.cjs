const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'visual-loader.js'), 'utf8');
const motionQuery = '(prefers-reduced-motion: reduce)';
const colorsQuery = '(forced-colors: active)';
const gatesKey = Symbol.for('codementor.visual-loader.test-gates');
const gates = globalThis[gatesKey] = new Map();
let fixtureId = 0;

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type) { for (const callback of [...(this.listeners.get(type) || [])]) callback(); }
  get count() { return [...this.listeners.values()].reduce((n, set) => n + set.size, 0); }
}

function setup(t, settings = {}) {
  const id = ++fixtureId;
  let resolveModule;
  const moduleGate = new Promise((resolve) => { resolveModule = resolve; });
  gates.set(id, { promise: moduleGate });
  t.after(() => { resolveModule(); gates.delete(id); });
  // Exercise the unchanged import() expression with Node's real ESM loader. The
  // browser URL adapter supplies a local data module instead of accessing Chrome.
  const moduleUrl = `data:text/javascript,${encodeURIComponent(`
    await globalThis[Symbol.for('codementor.visual-loader.test-gates')].get(${id}).promise;
    export function mount(target) {
      target.mounts++;
      target.dataset.visuals = 'ready';
      return () => { target.cleanups++; };
    }
  `)}`;

  const document = Object.assign(new Events(), { hidden: settings.hidden ?? false });
  const media = new Map([
    [motionQuery, Object.assign(new Events(), { matches: settings.motion ?? false })],
    [colorsQuery, Object.assign(new Events(), { matches: settings.colors ?? false })],
  ]);
  const scheduled = new Map();
  let nextId = 0;
  const calls = { canvas: 0, contexts: [], urls: [], releases: 0, cancelled: [] };
  document.createElement = (name) => {
    assert.equal(name, 'canvas');
    calls.canvas++;
    return { getContext: (name, options) => {
      calls.contexts.push({ name, options: JSON.parse(JSON.stringify(options)) });
      if (settings.webgl === false) return null;
      return { getExtension: (name) => {
        assert.equal(name, 'WEBGL_lose_context');
        return { loseContext: () => { calls.releases++; } };
      } };
    } };
  };
  const schedule = (callback) => { scheduled.set(++nextId, callback); return nextId; };
  const cancel = (id) => { calls.cancelled.push(id); scheduled.delete(id); };
  const context = vm.createContext({
    document,
    matchMedia: (query) => { assert.ok(media.has(query)); return media.get(query); },
    chrome: { runtime: { getURL: (file) => { calls.urls.push(file); return moduleUrl; } } },
    setTimeout: schedule,
    clearTimeout: cancel,
    ...(settings.idle === false ? {} : { requestIdleCallback: schedule, cancelIdleCallback: cancel }),
  });
  vm.runInContext(source, context, {
    filename: 'visual-loader.js',
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  });
  const target = {
    dataset: {}, style: {}, attributes: new Map(), isConnected: true, mounts: 0, cleanups: 0,
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
  const cleanup = context.CodeMentorVisuals.mount(target);
  t.after(cleanup);
  return {
    document, media, target, calls, scheduled, cleanup, resolveModule,
    mount: context.CodeMentorVisuals.mount,
    flush() {
      const next = scheduled.entries().next().value;
      assert.ok(next, 'Expected one scheduled visual start');
      scheduled.delete(next[0]);
      return next[1]();
    },
    visibility(hidden) { document.hidden = hidden; document.emit('visibilitychange'); },
    preference(query, matches) { media.get(query).matches = matches; media.get(query).emit('change'); },
    assertReleased() {
      assert.equal(scheduled.size, 0);
      assert.equal(document.count, 0);
      for (const entry of media.values()) assert.equal(entry.count, 0);
    },
  };
}

for (const preference of ['motion', 'colors']) {
  test(`${preference} preference preserves the fallback without probing WebGL or importing`, (t) => {
    const app = setup(t, { [preference]: true });
    assert.equal(app.target.dataset.visuals, 'fallback');
    assert.equal(app.target.attributes.get('aria-hidden'), 'true');
    assert.equal(app.target.style.pointerEvents, 'none');
    assert.equal(app.scheduled.size, 0);
    assert.equal(app.calls.canvas, 0);
    assert.deepEqual(app.calls.urls, []);
    app.cleanup();
    app.assertReleased();
  });
}

test('unavailable WebGL leaves the fallback without loading the visual bundle', async (t) => {
  const app = setup(t, { webgl: false });
  await app.flush();
  assert.equal(app.target.dataset.visuals, 'fallback');
  assert.equal(app.calls.canvas, 1);
  assert.deepEqual(app.calls.contexts, [{ name: 'webgl2', options: { failIfMajorPerformanceCaveat: true } }]);
  assert.deepEqual(app.calls.urls, []);
  assert.equal(app.target.mounts, 0);
  app.cleanup();
  app.assertReleased();
});

for (const idle of [true, false]) {
  test(`closing before ${idle ? 'idle callback' : 'timer fallback'} cancels all startup work`, (t) => {
    const app = setup(t, { idle });
    assert.equal(app.mount(app.target), app.cleanup, 'Repeated mounting must reuse the same lifecycle');
    assert.equal(app.scheduled.size, 1);
    app.cleanup();
    app.cleanup();
    assert.equal(app.calls.cancelled.length, 1);
    assert.equal(app.calls.canvas, 0);
    assert.deepEqual(app.calls.urls, []);
    app.visibility(true);
    app.visibility(false);
    app.preference(motionQuery, true);
    app.assertReleased();
  });
}

test('closing during the module import prevents a late mount and releases the WebGL probe', async (t) => {
  const app = setup(t);
  const pending = app.flush();
  assert.deepEqual(app.calls.urls, ['assets/visuals.js']);
  assert.equal(app.calls.releases, 1);
  app.cleanup();
  app.resolveModule();
  await pending;
  assert.equal(app.target.mounts, 0);
  assert.equal(app.target.cleanups, 0);
  app.assertReleased();
});

test('visibility stops and restarts the visual renderer without repeating the import or leaking listeners', async (t) => {
  const app = setup(t);
  app.resolveModule();
  await app.flush();
  assert.equal(app.target.mounts, 1);
  assert.equal(app.target.dataset.visuals, 'ready');
  app.visibility(true);
  assert.equal(app.target.cleanups, 1);
  assert.equal(app.target.dataset.visuals, 'fallback');
  assert.equal(app.scheduled.size, 0);
  app.visibility(false);
  await app.flush();
  assert.equal(app.target.mounts, 2);
  assert.deepEqual(app.calls.urls, ['assets/visuals.js']);
  assert.equal(app.calls.releases, 2);
  app.cleanup();
  assert.equal(app.target.cleanups, 2);
  app.assertReleased();
});

test('a hide/show cycle during a pending import mounts only the newest generation', async (t) => {
  const app = setup(t);
  const first = app.flush();
  app.visibility(true);
  app.visibility(false);
  const second = app.flush();
  app.resolveModule();
  await Promise.all([first, second]);
  assert.equal(app.target.mounts, 1);
  assert.deepEqual(app.calls.urls, ['assets/visuals.js']);
  app.cleanup();
  assert.equal(app.target.cleanups, 1);
  app.assertReleased();
});

test('changing motion and forced-color preferences disposes the active renderer and allows a later restart', async (t) => {
  const app = setup(t);
  app.resolveModule();
  await app.flush();
  app.preference(motionQuery, true);
  assert.equal(app.target.cleanups, 1);
  assert.equal(app.scheduled.size, 0);
  app.preference(colorsQuery, true);
  app.preference(motionQuery, false);
  assert.equal(app.scheduled.size, 0, 'Forced colors must still block rendering');
  app.preference(colorsQuery, false);
  await app.flush();
  assert.equal(app.target.mounts, 2);
  app.cleanup();
  assert.equal(app.target.cleanups, 2);
  app.assertReleased();
});
